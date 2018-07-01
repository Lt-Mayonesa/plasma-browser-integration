module.exports = {
	buf: function (obj) {
		return Buffer.from(JSON.stringify(obj));
	},

	_log: function(string) {
		console.error('log ::' + string);
	},

	fixData: function(data) {
		let str = '',
			open = [],
			close = [];
		for (let i = 0; i < data.length; i++) {
			let char = String.fromCharCode(data[i]);
			if (!open.length) {
				if (char === '{') {
					str += char;
					open.push(char);
				} else continue;
			} else {
				if (char === '}') {
					str += char;
					close.push(char);
				} else {
					str += char;
					if (char === '{') open.push(char);
				}
				if (open.length === close.length) {
					return str;
				}
			}
		}
		return str;
	}
};
