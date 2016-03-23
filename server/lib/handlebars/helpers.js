'use strict';

const moment = require('moment');

module.exports = {
	capitalizeFirst(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	},
	rfcDate(timestamp) {
		console.log('rfcDate', timestamp, parseInt(timestamp, 10), moment(parseInt(timestamp, 10)).format());// @nocommit
		const date = moment(parseInt(timestamp, 10));
		return date.format();
	},
	relativeDate(timestamp) {
		const date = moment(parseInt(timestamp, 10));
		return date.fromNow();
	},
};