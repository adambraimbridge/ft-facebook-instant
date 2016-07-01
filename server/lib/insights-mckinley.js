'use strict';

const fbApi = require('./fbApi');
const denodeify = require('denodeify');
const csvStringify = denodeify(require('csv-stringify'));

const pageId = process.env.FB_PAGE_ID;

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
	post_reactions_by_type_total: 'Daily total post reactions by type.',
	post_stories: 'Lifetime: The number of stories generated about your Page post. (Total Count)',
	post_stories_by_action_type: 'The number of stories created about your Page post, by action type. (Total Count)',
	post_storytellers_by_action_type: 'The number of unique people who created a story about your Page post by interacting with it. (Unique Users)',
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
	post_reactions_by_type_total: {
		like: true,
		love: true,
		wow: true,
		haha: true,
		sorry: true,
		anger: true,
	},
	post_stories_by_action_type: {
		share: true,
		like: true,
		comment: true,
	},
	post_storytellers_by_action_type: {
		share: true,
		like: true,
		comment: true,
	},
};

const iaKeys = [
	'id',
	'development_mode',
	'published',
];

const canonicalKeys = [
	'share',
];

const iaMetricTypes = {
	all_views: {period: 'day', aggregation: 'count'},
	all_view_durations: {period: 'week', aggregation: 'bucket'},
	all_scrolls: {period: 'week', aggregation: 'bucket'},
};

const integerColumns = [
	'post_shares',
	'post_likes',
	'post_comments',
	'canonical_share',
];

const statisticalColumns = [];

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

const getPostIds = params => {
	params.fields = 'id';
	const paramsQuery = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');

	return fbApi.call(`/${pageId}/posts?${paramsQuery}`, 'GET', {
		__limit: 0,
	})
	.then(result => result.data.map(item => item.id));
};

const createPostsQuery = ids => {
	const postEdgesQuery = postEdgeKeys.map(key => `${key}.limit(0).summary(true)`);
	const postAttributesQuery = postAttributeKeys.concat(postEdgesQuery).join(',');

	const params = {
		ids,
		fields: postAttributesQuery,
	};
	const paramsQuery = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');

	return `?${paramsQuery}`;
};

const createLinksQuery = () => `?ids={result=${postsResultPath}}&fields=og_object{type,url}`;

const createCanonicalsQuery = () => {
	const iaQuery = `instant_article{${iaKeys.join(',')}}`;
	const canonicalAttributesQuery = canonicalKeys.concat(iaQuery).join(',');

	return `?ids={result=${linksResultPath}}&fields=${canonicalAttributesQuery}`;
};

const createQuery = ({ids}) => {
	const queries = {
		posts: createPostsQuery(ids),
		links: createLinksQuery(),
		canonicals: createCanonicalsQuery(),
	};

	return Object.keys(queries).map(key => ({
		method: 'GET',
		omit_response_on_success: false,
		name: key,
		relative_url: queries[key],
	}));
};

const processResults = ([posts, links, canonicals]) => Object.keys(posts).map(id => {
	const post = posts[id];

	if(post.link && links[post.link] && links[post.link].og_object && links[post.link].og_object.url) {
		post.canonical = canonicals[links[post.link].og_object.url];
	}

	post.shares = post.shares ? post.shares.count : 0;
	post.likes = post.likes ? post.likes.summary.total_count : 0;
	post.comments = post.comments ? post.comments.summary.total_count : 0;
	post.canonical_url = post.canonical ? post.canonical.id : '';
	post.canonical_comments = post.canonical ? post.canonical.share.comment_count : 0;
	post.canonical_shares = post.canonical ? post.canonical.share.share_count : 0;

	post.has_instant_article = (post.canonical &&
			post.canonical.instant_article &&
			!post.canonical.instant_article.development_mode &&
			post.canonical.instant_article.published) ? 1 : 0;

	delete post.canonical;

	return post;
});

const getPostsData = ({ids}) => fbApi.many(
	{ids},
	(batch) =>
		fbApi.call('', 'POST', {
			batch: createQuery({ids: batch.ids}),
			include_headers: false,
			__dependent: true,
			__batched: true,
		})
		.then(processResults),
	'array'
);

module.exports.fetch = () => getPostIds({
	since: 1463652000, // Last 6 weeks
	until: 'now',
})
.then(ids => getPostsData({ids}))
.then(data => csvStringify(data, {
	header: true,
	columns: {
		id: 'id',
		is_published: 'is_published',
		type: 'type',
		name: 'title',
		// message: 'message',
		link: 'link',
		created_time: 'created_time',
		updated_time: 'updated_time',
		// description: 'description',
		shares: 'shares',
		likes: 'likes',
		comments: 'comments',
		canonical_url: 'canonical_url',
		canonical_comments: 'canonical_comments',
		canonical_shares: 'canonical_shares',
		has_instant_article: 'has_instant_article',
	},
}))
.catch(e => {
	console.log(`Insights import encountered an exception: ${e.stack || e}`);
	throw e;
});
