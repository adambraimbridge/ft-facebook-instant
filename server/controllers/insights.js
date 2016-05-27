'use strict';

const moment = require('moment');
const mode = require('../lib/mode').get();
const insights = require('../lib/insights');
const ravenClient = require('../lib/raven');
const promiseLoopInterval = require('@quarterto/promise-loop-interval');
const UPDATE_INTERVAL = 1 * 60 * 1000;

const fetch = () => {
	const since = moment.utc()
		.startOf('hour')
		.subtract(1, 'month');

	console.log(`${Date()}: INSIGHTS_FETCH periodic fetch starting now`);
	return insights.fetch({
		since,
		upload: true,
	})
	.then(() => {
		console.log(`${Date()}: INSIGHTS_FETCH periodic fetch complete`);
	})
	.catch(e => {
		console.error(`${Date()}: INSIGHTS_FETCH periodic fetch failed with error: ${e.stack || e}`);
		if(mode === 'production') {
			ravenClient.captureException(e, {tags: {from: 'insights'}});
		}
	});
};

const init = promiseLoopInterval(fetch, UPDATE_INTERVAL);

module.exports = {
	init,
};
