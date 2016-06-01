'use strict';

const fbApi = require('./fbApi');
const ftApi = require('./ftApi');
const s3 = require('./s3');
const database = require('./database');
const numbers = require('numbers');
const moment = require('moment');
const denodeify = require('denodeify');
const fs = require('fs');
const writeFile = denodeify(fs.writeFile);
const deleteFile = denodeify(fs.unlink);
const readDir = denodeify(fs.readdir);
const csvStringify = denodeify(require('csv-stringify'));
const path = require('path');
const mode = require('./mode').get();
const ravenClient = require('./raven');

const pageId = process.env.FB_PAGE_ID;
const BATCH_SIZE = 50;
const VERBOSE_AGGREGATIONS = false;
const EXPLAINER_ROW = false;

let importStart = null;

const postAttributeKeys = [
	'type',
	'shares',
	'name',
	'link',
	'created_time',
	'message',
	'id',
	'description',
	'is_published',
	'updated_time',
	'is_popular',
];

const postEdgeKeys = [
	'likes',
	'comments',
];

const insightsMetricsKeys = {
	post_impressions: 'The number of impressions for your Page post',
	post_impressions_unique: 'The number of people who saw your Page post',
	post_impressions_paid: 'The number of impressions for your Page post in an Ad or Sponsored Story',
	post_impressions_paid_unique: 'The number of people who saw your Page post in an Ad or Sponsored Story',
	post_impressions_fan: 'The number of impressions for your Page post by people who have liked your Page',
	post_impressions_fan_unique: 'The number of people who have like your Page who saw your Page post',
	post_impressions_fan_paid: 'The number of impressions for your Page post by people who like your Page in an Ad or Sponsored Story',
	post_impressions_fan_paid_unique: 'The number of people who have like your Page and saw your Page post in an Ad or Sponsored Story',
	post_impressions_organic: 'The number of impressions of your post in Newsfeed, Ticker, or on your Page\'s Wall',
	post_impressions_organic_unique: 'The number of people who saw your post in their Newsfeed or Ticker or on your Page\'s Wall',
	post_impressions_viral: 'The number of impressions of your Page post in a story generated by a friend',
	post_impressions_viral_unique: 'The number of people who saw your page post in a story from a friend',
	post_impressions_by_story_type: 'The number of times this post was seen via a story published by a friend of the person viewing the post',
	post_impressions_by_story_type_unique: 'The number of people who saw your page post in a story from a friend, by story type',
	post_consumptions: 'The number of times people clicked on anywhere in your posts without generating a story',
	post_consumptions_unique: 'The number of people who clicked anywhere in your post without generating a story',
	post_consumptions_by_type: 'The number of times people clicked on anywhere in your posts without generating a story, by consumption type',
	post_consumptions_by_type_unique: 'The number of people who clicked anywhere in your post without generating a story, by consumption type',
	post_engaged_users: 'The number of people who clicked anywhere in your posts',
	post_negative_feedback: 'The number of times people took a negative action in your post (e.g. hid it)',
	post_negative_feedback_unique: 'The number of people who took a negative action in your post (e.g., hid it)',
	post_negative_feedback_by_type: 'The number of times people took a negative action in your post broken down by type',
	post_negative_feedback_by_type_unique: 'The number of people who took a negative action in your post broken down by type',
	post_engaged_fan: 'People who have liked your page and engaged with your post.',
	post_fan_reach: 'Post reach by people who like your page.',
};

const insightsMetricsKeyTypes = {
	post_impressions_by_story_type: {
		other: true,
	},
	post_impressions_by_story_type_unique: {
		other: true,
	},
	post_consumptions_by_type: {
		'other clicks': true,
		'link clicks': true,
		'video play': true,
		'photo view': true,
	},
	post_consumptions_by_type_unique: {
		'other clicks': true,
		'link clicks': true,
		'video play': true,
		'photo view': true,
	},
	post_negative_feedback_by_type: {
		'hide all clicks': true,
		'hide clicks': true,
		'report spam clicks': true,
		'unlike page clicks': true,
	},
	post_negative_feedback_by_type_unique: {
		'hide all clicks': true,
		'hide clicks': true,
		'report spam clicks': true,
		'unlike page clicks': true,
	},
};

const insightsKeys = [
	'name',
	'period',
	'values',
];

const iaKeys = [
	'id',
	'development_mode',
	'published',
];

const iaKeysStatusOnly = [
	'most_recent_import_status',
];

const canonicalKeys = [
	'share',
];

const iaMetricTypes = {
	all_views: {period: 'day', aggregation: 'count'},
	all_view_durations: {period: 'week', aggregation: 'bucket'},
	all_scrolls: {period: 'week', aggregation: 'bucket'},
};

const requiredColumns = [
	'id',
	'type',
	'created_time',
	'updated_time',
];

const booleanColumns = [
	'is_published',
	'ia_published',
];

const integerColumns = [
	'post_shares',
	'post_likes',
	'post_comments',
	'canonical_share',
];

const statisticalColumns = [];

// Hardcoded because of brittle dependency in Redshift importer
const csvColumns = {
	id: 'id',
	timestamp: 'timestamp',
	type: 'type',
	created_time: 'created_time',
	updated_time: 'updated_time',
	is_published: 'is_published',
	link: 'link',
	canonical: 'canonical',
	uuid: 'uuid',
	ia_published: 'ia_published',
	ia_earliest_views: 'ia_earliest_views',
	ia_import_status: 'ia_import_status',
	post_shares: 'post_shares',
	post_likes: 'post_likes',
	post_comments: 'post_comments',
	canonical_share: 'canonical_share',
	insight_post_impressions: 'insight_post_impressions',
	insight_post_impressions_unique: 'insight_post_impressions_unique',
	insight_post_impressions_paid: 'insight_post_impressions_paid',
	insight_post_impressions_paid_unique: 'insight_post_impressions_paid_unique',
	insight_post_impressions_fan: 'insight_post_impressions_fan',
	insight_post_impressions_fan_unique: 'insight_post_impressions_fan_unique',
	insight_post_impressions_fan_paid: 'insight_post_impressions_fan_paid',
	insight_post_impressions_fan_paid_unique: 'insight_post_impressions_fan_paid_unique',
	insight_post_impressions_organic: 'insight_post_impressions_organic',
	insight_post_impressions_organic_unique: 'insight_post_impressions_organic_unique',
	insight_post_impressions_viral: 'insight_post_impressions_viral',
	insight_post_impressions_viral_unique: 'insight_post_impressions_viral_unique',
	insight_post_impressions_by_story_type_other: 'insight_post_impressions_by_story_type_other',
	insight_post_impressions_by_story_type_unique_other: 'insight_post_impressions_by_story_type_unique_other',
	insight_post_consumptions: 'insight_post_consumptions',
	insight_post_consumptions_unique: 'insight_post_consumptions_unique',
	'insight_post_consumptions_by_type_other clicks': 'insight_post_consumptions_by_type_other_clicks',
	'insight_post_consumptions_by_type_link clicks': 'insight_post_consumptions_by_type_link_clicks',
	'insight_post_consumptions_by_type_video play': 'insight_post_consumptions_by_type_video_play',
	'insight_post_consumptions_by_type_photo view': 'insight_post_consumptions_by_type_photo_view',
	'insight_post_consumptions_by_type_unique_other clicks': 'insight_post_consumptions_by_type_unique_other_clicks',
	'insight_post_consumptions_by_type_unique_link clicks': 'insight_post_consumptions_by_type_unique_link_clicks',
	'insight_post_consumptions_by_type_unique_video play': 'insight_post_consumptions_by_type_unique_video_play',
	'insight_post_consumptions_by_type_unique_photo view': 'insight_post_consumptions_by_type_unique_photo_view',
	insight_post_engaged_users: 'insight_post_engaged_users',
	insight_post_negative_feedback: 'insight_post_negative_feedback',
	insight_post_negative_feedback_unique: 'insight_post_negative_feedback_unique',
	'insight_post_negative_feedback_by_type_hide all clicks': 'insight_post_negative_feedback_by_type_hide_all_clicks',
	'insight_post_negative_feedback_by_type_hide clicks': 'insight_post_negative_feedback_by_type_hide_clicks',
	'insight_post_negative_feedback_by_type_report spam clicks': 'insight_post_negative_feedback_by_type_report_spam_clicks',
	'insight_post_negative_feedback_by_type_unlike page clicks': 'insight_post_negative_feedback_by_type_unlike_page_clicks',
	'insight_post_negative_feedback_by_type_unique_hide all clicks': 'insight_post_negative_feedback_by_type_unique_hide_all_clicks',
	'insight_post_negative_feedback_by_type_unique_hide clicks': 'insight_post_negative_feedback_by_type_unique_hide_clicks',
	'insight_post_negative_feedback_by_type_unique_report spam clicks': 'insight_post_negative_feedback_by_type_unique_report_spam_clicks',
	'insight_post_negative_feedback_by_type_unique_unlike page clicks': 'insight_post_negative_feedback_by_type_unique_unlike_page_clicks',
	insight_post_engaged_fan: 'insight_post_engaged_fan',
	insight_post_fan_reach: 'insight_post_fan_reach',
	ia_all_views: 'ia_all_views',
	ia_all_view_durations_min: 'ia_all_view_durations_min',
	ia_all_view_durations_max: 'ia_all_view_durations_max',
	ia_all_view_durations_mean: 'ia_all_view_durations_mean',
	ia_all_view_durations_median: 'ia_all_view_durations_median',
	ia_all_view_durations_mode: 'ia_all_view_durations_mode',
	ia_all_view_durations_stdev: 'ia_all_view_durations_stdev',
	ia_all_view_durations_p25: 'ia_all_view_durations_p25',
	ia_all_view_durations_p50: 'ia_all_view_durations_p50',
	ia_all_view_durations_p75: 'ia_all_view_durations_p75',
	ia_all_view_durations_p95: 'ia_all_view_durations_p95',
	ia_all_scrolls_min: 'ia_all_scrolls_min',
	ia_all_scrolls_max: 'ia_all_scrolls_max',
	ia_all_scrolls_mean: 'ia_all_scrolls_mean',
	ia_all_scrolls_median: 'ia_all_scrolls_median',
	ia_all_scrolls_mode: 'ia_all_scrolls_mode',
	ia_all_scrolls_stdev: 'ia_all_scrolls_stdev',
	ia_all_scrolls_p25: 'ia_all_scrolls_p25',
	ia_all_scrolls_p50: 'ia_all_scrolls_p50',
	ia_all_scrolls_p75: 'ia_all_scrolls_p75',
	ia_all_scrolls_p95: 'ia_all_scrolls_p95',
};

Object.keys(insightsMetricsKeys).forEach(key => {
	if(insightsMetricsKeyTypes[key]) {
		Object.keys(insightsMetricsKeyTypes[key]).forEach(type => {
			integerColumns.push(`insight_${key}_${type}`);
		});
	} else {
		integerColumns.push(`insight_${key}`);
	}
});

Object.keys(iaMetricTypes).forEach(key => {
	switch(iaMetricTypes[key].aggregation) {
		case 'count':
			integerColumns.push(`ia_${key}`);
			break;
		case 'bucket':
			['min', 'max', 'mean', 'median', 'mode', 'stdev', 'p25', 'p50', 'p75', 'p95'].forEach(type => {
				statisticalColumns.push(`ia_${key}_${type}`);
			});
			break;
		default:
			throw Error(`Unexpected Instant Article metric aggregation [${iaMetricTypes[key].aggregation}] for key [${key}]`);
	}
});

const postsResultPath = 'posts:$.*.link';
const linksResultPath = 'links:$.*.og_object.url';

const getPostsLists = params => {
	params.fields = 'id';
	const paramsQuery = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');

	return fbApi.call(`/${pageId}/posts?${paramsQuery}`, 'GET', {
		__limit: 0,
	});
};

const createPostsQuery = ids => {
	const postEdgesQuery = postEdgeKeys.map(key => `${key}.limit(0).summary(true)`);
	const insightsQuery = `insights.metric(${Object.keys(insightsMetricsKeys).join(',')}){${insightsKeys.join(',')}}`;
	const postAttributesQuery = postAttributeKeys.concat(postEdgesQuery).concat(insightsQuery).join(',');

	const params = {
		ids,
		fields: postAttributesQuery,
	};
	const paramsQuery = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');

	return `?${paramsQuery}`;
};

const createLinksQuery = () => `?ids={result=${postsResultPath}}&fields=og_object{type,url}`;

const createCanonicalsQuery = lastRun => {
	// "The data is only available after 24 March, 2016" => 1458864000
	const since = lastRun ? moment.utc(lastRun.timestamp).subtract(1, 'week') : moment.utc(1458864000000);

	const iaMetricQueries = Object.keys(iaMetricTypes).map(key =>
		`insights.metric(${key}).period(${iaMetricTypes[key].period}).since(${since.unix()}).until(now).as(metrics_${key})`
	);
	const iaKeysStatusOnlyQuery = iaKeysStatusOnly.map(key => `${key}{status}`);
	const iaQuery = `instant_article{${iaKeys.concat(iaKeysStatusOnlyQuery).concat(iaMetricQueries).join(',')}}`;
	const canonicalAttributesQuery = canonicalKeys.concat(iaQuery).join(',');

	return `?ids={result=${linksResultPath}}&fields=${canonicalAttributesQuery}`;
};

const createQuery = ({lastRun, ids}) => {
	const queries = {
		posts: createPostsQuery(ids),
		links: createLinksQuery(),
		canonicals: createCanonicalsQuery(lastRun),
	};

	return Object.keys(queries).map(key => ({
		method: 'GET',
		omit_response_on_success: false,
		name: key,
		relative_url: queries[key],
	}));
};

const getAggregationStatistics = values => ({
	min: values[0],
	max: values[values.length - 1],
	mean: Math.round(numbers.statistic.mean(values) * 100) / 100,
	median: numbers.statistic.median(values),
	mode: numbers.statistic.mode(values),
	stdev: Math.round(numbers.statistic.standardDev(values) * 100) / 100,
	p25: numbers.statistic.quantile(values, 25, 100),
	p50: numbers.statistic.quantile(values, 50, 100),
	p75: numbers.statistic.quantile(values, 75, 100),
	p95: numbers.statistic.quantile(values, 95, 100),
});

const getTotalAggregateValue = data => data.reduce((counter, item) => (counter + item.value), 0);

const aggregateMetricBreakdowns = (data) => {
	const periods = {};
	data.forEach(item => {
		periods[item.time] = periods[item.time] || [];
		periods[item.time].push({
			bucket: parseInt(item.breakdowns.bucket, 10),
			value: parseInt(item.value, 10),
		});
	});

	const busiestPeriod = Object.keys(periods).sort((a, b) => getTotalAggregateValue(periods[a]) - getTotalAggregateValue(periods[b]))[0];

	const aggregations = {};
	let values = [];

	periods[busiestPeriod]
		.sort((a, b) => a.bucket - b.bucket)
		.forEach(item => {
			if(VERBOSE_AGGREGATIONS) aggregations[item.bucket] = item.value;
			values = values.concat(Array(item.value).fill(item.bucket));
		});

	return Object.assign(aggregations, getAggregationStatistics(values));
};

const flattenIaMetrics = (post, flat) => {
	Object.keys(iaMetricTypes).forEach(key => {
		const metric = post.canonical && post.canonical.instant_article && post.canonical.instant_article[`metrics_${key}`];
		let aggregations;
		switch(iaMetricTypes[key].aggregation) {
			case 'count':
				flat[`ia_${key}`] = metric ? metric.data.reduce((total, item) => (total + parseInt(item.value, 10)), 0) : 0;
				break;
			case 'bucket':
				aggregations = metric ? aggregateMetricBreakdowns(metric.data) : getAggregationStatistics([0]);
				Object.keys(aggregations).forEach(aggregation => {
					flat[`ia_${key}_${aggregation}`] = aggregations[aggregation];
				});
				break;
			default:
				throw Error(`Unexpected Instant Article metric aggregation [${iaMetricTypes[key].aggregation}] for key [${key}]`);
		}
	});
};

const getEarliestIaView = post => {
	if(!post.canonical.instant_article.metrics_all_views) return null;

	const earliest = post.canonical.instant_article.metrics_all_views.data
		.map(item => new Date(item.time).getTime())
		.sort((a, b) => a - b)
		[0];

	return moment.utc(earliest)
		.format();
};

const getUuid = canonical => database.getCapi(canonical)
.then(cached => cached || ftApi.fetchByCanonical(canonical))
.then(article => article && article.id || null)
.catch(() => null);

const flattenPost = post => Promise.resolve()
.then(() => {
	const flat = {
		id: post.id,
		type: post.type,
		name: post.name,
		link: post.link,
		created_time: post.created_time,
		message: post.message,
		description: post.description,
		is_published: post.is_published,
		updated_time: post.updated_time,

		// Default values
		canonical: null,
		uuid: null,
		canonical_share: 0,
		ia_published: 0,
		ia_earliest_views: null,
		ia_import_status: null,
	};

	flat.post_shares = post.shares && post.shares.count;
	flat.post_likes = post.likes && post.likes.summary.total_count;
	flat.post_comments = post.comments && post.comments.summary.total_count;

	Object.keys(insightsMetricsKeys).forEach(insightKey => {
		const insight = post.insights[insightKey];
		if(insight) {
			if(insightsMetricsKeyTypes[insightKey]) {
				Object.keys(insightsMetricsKeyTypes[insightKey]).forEach(valueKey => {
					flat[`insight_${insightKey}_${valueKey}`] = insight.values[0].value[valueKey] || 0;
				});
			} else {
				flat[`insight_${insightKey}`] = insight.values[0].value || 0;
			}
		} else {
			if(insightsMetricsKeyTypes[insightKey]) {
				Object.keys(insightsMetricsKeyTypes[insightKey]).forEach(valueKey => {
					flat[`insight_${insightKey}_${valueKey}`] = 0;
				});
			} else {
				flat[`insight_${insightKey}`] = 0;
			}
		}
	});

	if(post.canonical) {
		flat.canonical = post.canonical.id;
		flat.canonical_share = post.canonical.share.share_count;

		if(post.canonical.instant_article) {
			flat.ia_published = post.canonical.instant_article.published;
			flat.ia_earliest_views = getEarliestIaView(post);
			flat.ia_import_status = post.canonical.instant_article.most_recent_import_status &&
				post.canonical.instant_article.most_recent_import_status.status;
		}
	}

	flattenIaMetrics(post, flat);
	return flat;
})
.then(flat => {
	if(!flat.canonical) return flat;

	return getUuid(flat.canonical)
		.then(uuid => Object.assign(flat, {uuid}));
});

const processResults = ([posts, links, canonicals]) => Object.keys(posts).map(id => {
	const post = posts[id];

	if(post.link && links[post.link] && links[post.link].og_object && links[post.link].og_object.url) {
		post.canonical = canonicals[links[post.link].og_object.url];
	}

	const insights = post.insights.data;
	post.insights = {};
	insights.forEach(item => (post.insights[item.name] = item));

	return post;
});

const executeQuery = ({lastRun, ids}) => fbApi.call('', 'POST', {
	batch: createQuery({lastRun, ids}),
	include_headers: false,
	__dependent: true,
	__batched: true,
})
.then(processResults);

const batchIdList = idList => {
	const batch = [];
	for(let i = 0; i < idList.length; i += BATCH_SIZE) {
		batch.push(
			idList
				.slice(i, i + BATCH_SIZE)
				.map(item => item.id)
		);
	}
	return batch;
};

const addExplainerRow = data => {
	const explainer = {
		id: 'key',
	};

	Object.keys(insightsMetricsKeys).forEach(key => {
		if(insightsMetricsKeyTypes[key]) {
			Object.keys(insightsMetricsKeyTypes[key]).forEach(type => {
				explainer[`insight_${key}_${type}`] = `${insightsMetricsKeys[key]}`;
			});
		} else {
			explainer[`insight_${key}`] = `${insightsMetricsKeys[key]}`;
		}
	});
	data.unshift(explainer);
};

const generateCsv = ({data, header}) => {
	if(EXPLAINER_ROW) {
		addExplainerRow(data);
	}

	return csvStringify(data, {
		header,
		columns: csvColumns,
	});
};

const diffIntegerValues = (newValues, oldValues) => {
	const values = {};
	integerColumns.forEach(column => {
		const oldValue = oldValues && oldValues[column] || 0;
		values[column] = newValues[column] - oldValue;
	});

	return values;
};

const getValueDiffs = ({post, now, ageLimit, lastValues}) => {
	const created = moment.utc(post.created_time);
	const then = moment.max(created, ageLimit);
	const hoursDifference = now.diff(then, 'hours');

	const ret = {
		age: hoursDifference || 0,
	};

	const diff = diffIntegerValues(post, lastValues);
	const postWithDiffValues = Object.assign({}, post, diff);

	if(!hoursDifference) {
		return Object.assign(ret, {
			values: postWithDiffValues,
		});
	}

	const averagePost = Object.assign({}, postWithDiffValues);

	integerColumns.forEach(column => {
		const divisor = hoursDifference + 1;
		const average = Math.round(postWithDiffValues[column] / divisor * 100) / 100;
		averagePost[column] = average;
	});

	return Object.assign(ret, {
		values: averagePost,
	});
};

const validate = post => {
	// Error if required NOT NULL columns are empty
	requiredColumns.forEach(column => {
		if(!post[column]) {
			ravenClient.captureMessage(`Empty value for required field ${column}`, {
				extra: {
					post,
				},
				tags: {from: 'insights'},
			});
			throw Error(`Empty value for required field ${column}`);
		}
	});

	booleanColumns.concat(integerColumns).concat(statisticalColumns).forEach(column => {
		post[column] = post[column] || 0;
	});
	return post;
};

// Use async function to avoid eating memory
const getCsvRows = (posts, age, historicTimestampUtc) => Promise.resolve()
.then(() => {
	const rows = [];
	posts.forEach(post => {
		if(post.age < age) return;
		rows.push(
			Object.assign({}, post.values, {timestamp: historicTimestampUtc})
		);
	});

	return rows;
});

const writeCsv = (now, posts) => {
	const random8 = Math.floor(Math.random() * 90000000) + 10000000;
	const filename = `facebookinstantinsights-${random8}-${now.format('YYYYMMDDHHmmss')}`;
	const localPath = path.resolve(process.cwd(), `insights/${filename}.csv`);
	const oldestPostAge = posts.sort((a, b) => b.age - a.age)[0].age;

	let rows = 0;
	// Generate CSVs in series to avoid eating up memory
	return Array.apply(0, Array(oldestPostAge + 1))
		.map((x, index) => oldestPostAge - index)
		.reduce((promise, age, index) => promise.then(() => {
			const historicTimestamp = moment.utc(now).subtract(age + 1, 'hours');
			const historicTimestampUtc = historicTimestamp.format();
			return getCsvRows(posts, age, historicTimestampUtc)
				.then(data => (rows += data.length, data))
				.then(data => generateCsv({data, header: (index === 0)}))
				.then(csv => writeFile(localPath, csv, {flag: 'a'}));
		}), Promise.resolve())
		.then(() => {
			console.log(`Wrote CSV with ${rows} rows to ${localPath}.`);
			return {localPath, filename};
		});
};

const uploadCsv = ({localPath, filename}) => {
	console.log(`Uploading CSV from ${localPath} to Amazon S3.`);

	// Data team prefer .txt suffix for some reason
	return s3.upload(localPath, `${filename}.txt`)
		.then(() => {
			console.log(`Uploading complete, will delete CSV from ${localPath}.`);
			return deleteFile(localPath);
		});
};

const uploadHistoricCsvs = () => readDir(path.resolve(process.cwd(), 'insights/'))
.then(items => Promise.all(
	items
		.filter(item => /^facebookinstantinsights-\d{8}-\d{14}\.csv$/.test(item))
		.map(item => item.slice(0, -4))
		.map(filename => (console.log(`Found historic CSV to upload at insights/${filename}.csv`), filename))
		.map(filename => uploadCsv({
			localPath: path.resolve(process.cwd(), `insights/${filename}.csv`),
			filename,
		}))
));

const getHistoricValues = (lastRun, now, posts) => Promise.resolve(
	posts.map(post =>
		getValueDiffs({
			post,
			now,
			ageLimit: lastRun ? moment.utc(lastRun.timestamp).add(1, 'hour') : moment.utc(0),
			lastValues: lastRun ? lastRun.data[post.id] : {},
		})
	)
);

const saveLastRun = (now, posts) => {
	const data = {};

	posts.forEach(post => {
		const integers = {};
		integerColumns.forEach(column => {
			integers[column] = post[column];
		});
		data[post.id] = integers;
	});

	return database.setLastInsight(now.valueOf(), data);
};


module.exports.fetch = ({since, upload = false}) => Promise.resolve()
.then(() => {
	if(importStart) {
		const seconds = Math.round((Date.now() - importStart) / 1000);
		if(seconds > (60 * 10)) {
			throw Error('Insights import has been running for more than 10 minutes.');
		}
		console.log(`Insights import is already running (process is ${seconds} old). No further work to do`);
		return;
	}

	console.log(`Insights import starting. Will ${upload || 'not '}upload to Amazon S3`);
	importStart = Date.now();

	return Promise.resolve()
		.then(() => upload && uploadHistoricCsvs())
		.then(database.getLastInsight)
		.then(lastRun => {
			const now = moment.utc().startOf('hour');

			if(lastRun) {
				const lastRunMoment = moment.utc(lastRun.timestamp);
				const age = now.diff(lastRunMoment, 'hours', true);

				if(lastRun.timestamp === now.valueOf()) {
					console.log(`Insights data already processed for ${now.format()}`);
					importStart = null;
					return;
				} else if(age > 1) {
					console.log(`Warning: last run was ${age} hours ago (should be run every hour).`);
					if(mode === 'production') {
						ravenClient.captureMessage('Last insights import > 1 hour', {
							extra: {
								lastRunAge: `${age} hours`,
								lastRun: lastRun.format(),
								now: now.format(),
							},
							tags: {from: 'insights'},
						});
					}
				}

				console.log(`Fetching insights data from ${since.format()} to ${now.format()}. Last run was ${lastRunMoment.format()} (${age} hours ago).`);
			} else {
				console.log(`Fetching insights data from ${since.format()} to ${now.format()}. No saved lastRun.`);
			}

			return getPostsLists({
				since: since.unix(),
				until: now.unix(),
			})
			.then(result => (batchIdList(result.data)))
			.then(idBatch => Promise.all(idBatch.map(ids => executeQuery({lastRun, ids}))))
			.then(batchedResults => [].concat(...batchedResults))
			.then(posts => Promise.all(posts.map(flattenPost)))
			.then(posts => posts.map(validate))
			.then(posts =>
				getHistoricValues(lastRun, now, posts)
					.then(historic => writeCsv(now, historic))
					.then(({localPath, filename}) =>
						// CSV has been generated, so this run has been a success even if file couldn't be uploaded (which can be done another time)
						saveLastRun(now, posts)
						.then(() => upload && uploadCsv({localPath, filename}))
					)
			)
			.then(() => (importStart = null));
		});
})
.catch(e => {
	console.log(`Insights import encountered an exception: ${e.stack || e}`);
	importStart = null;
	throw e;
});
