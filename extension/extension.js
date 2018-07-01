/*
    Copyright (C) 2017 Kai Uwe Broulik <kde@privat.broulik.de>

    This program is free software; you can redistribute it and/or
    modify it under the terms of the GNU General Public License as
    published by the Free Software Foundation; either version 3 of
    the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var port;
var callbacks = {}; // TODO rename to "portCallbacks"?
var runtimeCallbacks = {};

// tracks whether an extension is loaded and what version
var subsystemStatus = {};

function addCallback(
	subsystem,
	action,
	callback // TODO rename to "addPortCallbacks"?
) {
	if (action.constructor === Array) {
		action.forEach(function(item) {
			addCallback(subsystem, item, callback);
		});
		return;
	}

	if (!callbacks[subsystem]) {
		callbacks[subsystem] = {};
	}
	callbacks[subsystem][action] = callback;
}

function sendPortMessage(subsystem, event, payload) {
	// why do we put stuff on root level here but otherwise have a "payload"? :(
	var message = payload || {};
	message.subsystem = subsystem;
	message.event = event;

	console.log('send port message: ', message.event);
	console.log(message);
	port.postMessage(message);
}

function sendEnvironment() {
	var browser = '';

	var ua = navigator.userAgent;
	// Try to match the most derived first
	if (ua.match(/vivaldi/i)) {
		browser = 'vivaldi';
	} else if (ua.match(/OPR/i)) {
		browser = 'opera';
	} else if (ua.match(/chrome/i)) {
		browser = 'chromium';
		// Apparently there is no better way to distinuish chromium from chrome
		for (i in window.navigator.plugins) {
			if (window.navigator.plugins[i].name === 'Chrome PDF Viewer') {
				browser = 'chrome';
				break;
			}
		}
	} else if (ua.match(/firefox/i)) {
		browser = 'firefox';
	}

	sendPortMessage('settings', 'setEnvironment', { browserName: browser });
}

function sendSettings() {
	let messages = ['play', 'pause', 'stop', 'next', 'previous'],
		i = 0;
	let inter = setInterval(function() {
		sendPortMessage('mpris', 'controls', {
			action: messages[i++]
		});
		if (i >= messages.length) clearInterval(inter);
	}, 100);
}

function addRuntimeCallback(subsystem, action, callback) {
	if (action.constructor === Array) {
		action.forEach(function(item) {
			addRuntimeCallback(subsystem, item, callback);
		});
		return;
	}

	if (!runtimeCallbacks[subsystem]) {
		runtimeCallbacks[subsystem] = {};
	}
	runtimeCallbacks[subsystem][action] = callback;
}

// returns an Object which only contains values for keys in allowedKeys
function filterObject(obj, allowedKeys) {
	var newObj = {};

	// I bet this can be done in a more efficient way
	for (key in obj) {
		if (obj.hasOwnProperty(key) && allowedKeys.indexOf(key) > -1) {
			newObj[key] = obj[key];
		}
	}

	return newObj;
}

// filters objects within an array so they only contain values for keys in allowedKeys
function filterArrayObjects(arr, allowedKeys) {
	return arr.map(function(item) {
		return filterObject(item, allowedKeys);
	});
}

// activates giveb tab and raises its window, used by tabs runner and mpris Raise command
function raiseTab(tabId) {
	// first activate the tab, this means it's current in its window
	chrome.tabs.update(tabId, { active: true }, function(tab) {
		if (chrome.runtime.lastError || !tab) {
			// this "lastError" stuff feels so archaic
			// failed to update
			return;
		}

		// then raise the tab's window too
		chrome.windows.update(tab.windowId, { focused: true });
	});
}

// MPRIS
// ------------------------------------------------------------------------
//

var currentPlayerTabId = 0;

// when tab is closed, tell the player is gone
// below we also have a "gone" signal listener from the content script
// which is invoked in the onbeforeunload handler of the page
chrome.tabs.onRemoved.addListener(function(tabId) {
	if (tabId == currentPlayerTabId) {
		// our player is gone :(
		currentPlayerTabId = 0;
		sendPortMessage('mpris', 'gone');
	}
});

// callbacks from host (Plasma) to our extension
addCallback('mpris', 'raise', function(message) {
	if (currentPlayerTabId) {
		raiseTab(currentPlayerTabId);
	}
});

addCallback(
	'mpris',
	['play', 'pause', 'playPause', 'stop', 'next', 'previous'],
	function(message, action) {
		if (currentPlayerTabId) {
			chrome.tabs.sendMessage(currentPlayerTabId, {
				subsystem: 'mpris',
				action: action
			});
		}
	}
);

addCallback('mpris', 'setVolume', function(message) {
	if (currentPlayerTabId) {
		chrome.tabs.sendMessage(currentPlayerTabId, {
			subsystem: 'mpris',
			action: 'setVolume',
			payload: {
				volume: message.volume
			}
		});
	}
});

addCallback('mpris', 'setLoop', function(message) {
	if (currentPlayerTabId) {
		chrome.tabs.sendMessage(currentPlayerTabId, {
			subsystem: 'mpris',
			action: 'setLoop',
			payload: {
				loop: message.loop
			}
		});
	}
});

addCallback('mpris', 'setPosition', function(message) {
	if (currentPlayerTabId) {
		chrome.tabs.sendMessage(currentPlayerTabId, {
			subsystem: 'mpris',
			action: 'setPosition',
			payload: {
				position: message.position
			}
		});
	}
});

addCallback('mpris', 'setPlaybackRate', function(message) {
	if (currentPlayerTabId) {
		chrome.tabs.sendMessage(currentPlayerTabId, {
			subsystem: 'mpris',
			action: 'setPlaybackRate',
			payload: {
				playbackRate: message.playbackRate
			}
		});
	}
});

// callbacks from a browser tab to our extension
addRuntimeCallback('mpris', 'playing', function(message, sender) {
	// Chrome doesn't run extensions in incognito by default but Firefox does
	// so we disable media controls for them to prevent accidental private
	// information leak on lock screen or now playing auto status in a messenger
	if (IS_FIREFOX && sender.tab.incognito) {
		return;
	}

	currentPlayerTabId = sender.tab.id;
	console.log('player tab is now', currentPlayerTabId);

	var payload = message || {};
	payload.tabTitle = sender.tab.title;
	payload.url = sender.tab.url;

	sendPortMessage('mpris', 'playing', payload);
});

addRuntimeCallback('mpris', 'gone', function(message, sender) {
	if (currentPlayerTabId == sender.tab.id) {
		console.log('Player navigated away');
		currentPlayerTabId = 0;
		sendPortMessage('mpris', 'gone');
	}
});

addRuntimeCallback(
	'mpris',
	['paused', 'stopped', 'waiting', 'canplay'],
	function(message, sender, action) {
		if (currentPlayerTabId == sender.tab.id) {
			sendPortMessage('mpris', action);
		}
	}
);

addRuntimeCallback(
	'mpris',
	[
		'duration',
		'timeupdate',
		'seeking',
		'seeked',
		'ratechange',
		'volumechange'
	],
	function(message, sender, action) {
		if (currentPlayerTabId == sender.tab.id) {
			sendPortMessage('mpris', action, message);
		}
	}
);

addRuntimeCallback('mpris', ['metadata', 'callbacks'], function(
	message,
	sender,
	action
) {
	if (currentPlayerTabId == sender.tab.id) {
		var payload = {};
		payload[action] = message;

		sendPortMessage('mpris', action, payload);
	}
});

// Debug
// ------------------------------------------------------------------------
//
addCallback('debug', 'debug', function(payload) {
	console.log('From host:', payload.message);
});

addCallback('debug', 'warning', function(payload) {
	console.warn('From host:', payload.message);
});

// System
// ------------------------------------------------------------------------
//

// When connecting to native host fails (e.g. not installed), we immediately get a disconnect
// event immediately afterwards. Also avoid infinite restart loop then.
var receivedMessageOnce = false;

// Check for supported platform to avoid loading it on e.g. Windows and then failing
// when the extension got synced to another device and then failing
chrome.runtime.getPlatformInfo(function(info) {
	if (!SUPPORTED_PLATFORMS.includes(info.os)) {
		console.log('This extension is not supported on', info.os);
		return;
	}

	connectHost();
});

function connectHost() {
	port = chrome.runtime.connectNative('com.google.chrome.example.echo');

	port.onMessage.addListener(function(message) {
		console.log('on message', message);
		var subsystem = message.subsystem;
		var action = message.action;

		if (!subsystem || !action) {
			return;
		}

		receivedMessageOnce = true;

		// keeps track of what extensions are loaded and in what version in subsystemStatus
		if (action === 'created') {
			subsystemStatus[subsystem] = {
				version: message.payload.version,
				loaded: false
			};
			return;
		} else if (action === 'loaded') {
			subsystemStatus[subsystem].loaded = true;
			return;
		} else if (action === 'unloaded') {
			subsystemStatus[subsystem].loaded = false;
			return;
		}

		if (callbacks[subsystem] && callbacks[subsystem][action]) {
			callbacks[subsystem][action](message.payload, action);
		} else {
			console.warn(
				"Don't know what to do with host message",
				subsystem,
				action
			);
		}
	});

	port.onDisconnect.addListener(function() {
		var error = chrome.runtime.lastError;

		console.warn('Host disconnected', error);

		var reason = chrome.i18n.getMessage('general_error_unknown');
		if (error && error.message) {
			reason = error.message;
		}

		var message = receivedMessageOnce
			? chrome.i18n.getMessage('general_error_port_disconnect', reason)
			: chrome.i18n.getMessage('general_error_port_startupfail');

		chrome.notifications.create(null, {
			type: 'basic',
			title: chrome.i18n.getMessage('general_error_title'),
			message: message,
			iconUrl: 'icons/sad-face-128.png'
		});

		if (receivedMessageOnce) {
			console.log('Auto-restarting it');
			connectHost();
		} else {
			console.warn(
				"Not auto-restarting host as we haven't received any message from it before. Check that it's working/installed correctly"
			);
		}
	});

	//sendEnvironment();
	sendSettings();
}

addRuntimeCallback('settings', 'changed', function() {
	// we could also just reload our extension :)
	// but this also causes the settings dialog to quit
	//chrome.runtime.reload();
	sendSettings();
});

addRuntimeCallback('settings', 'openKRunnerSettings', function() {
	sendPortMessage('settings', 'openKRunnerSettings');
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	// TODO check sender for privilege

	var subsystem = message.subsystem;
	var action = message.action;

	if (!subsystem || !action) {
		return;
	}

	if (runtimeCallbacks[subsystem] && runtimeCallbacks[subsystem][action]) {
		runtimeCallbacks[subsystem][action](message.payload, sender, action);
	} else {
		console.warn(
			"Don't know what to do with runtime message",
			subsystem,
			action
		);
	}
});
