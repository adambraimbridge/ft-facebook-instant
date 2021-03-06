'use strict';

const partitionPromiseParallel = require('@quarterto/partition-promise-parallel');
const transform = require('../lib/transform');
const articleModel = require('./article');
const database = require('../lib/database');
const getCanonical = require('./canonical');
const fbApi = require('../lib/fbApi');
const mode = require('../lib/mode');

exports.get = async function get() {
	const since = await database.getLastABCheck();
	const current = Date.now() / 1000; // get this as soon as possible because this might take a while
	const results = !since ? [] : await fbApi.posts({since}); // don't do anything for the first run

	await database.setLastABCheck(current);
	return results.map(({link: origUrl, id}) => ({origUrl, id}));
};

exports.getPostCanonical = post => getCanonical(post.origUrl).then(
	canonical => Object.assign(post, {canonical}),
	err => {
		if(err.type === 'FtApiContentMissingException') {
			post.error = err;
			return null; // ignore things not in elastic search, i.e. non-articles or old articles
		}

		throw err;
	}
);

exports.hydratePostWithArticle = post => articleModel
	.get(post.canonical)
	.then(article => Object.assign(post, article));

exports.canRenderPost = post => transform(post).then(
	rendered => {
		post.rendered = rendered;
		return true;
	},
	error => {
		post.error = error;

		return false;
	}
);

exports.isDupeFactory = (seenPosts = new Map(), dupePosts = new Map()) => async function isDupe(post) {
	// remove new posts that are already in the AB test *or* are in the current batch multiple times
	// (except not actually remove, but mark as removed so future runs can see them)
	const alreadyInTest = !!(await database.getFBLinkPost(post.canonical));
	const dupeInBatch = seenPosts.has(post.canonical);

	if(alreadyInTest || dupeInBatch) {
		await exports.markRemoved(post.canonical);
		post.status = {alreadyInTest, dupeInBatch};
		seenPosts.delete(post.canonical);
		dupePosts.set(post.canonical, post);

		return true;
	}

	seenPosts.set(post.canonical, post);
	return false;
};

exports.canPublishPost = async function canPublishPost(post) {
	try {
		const {errors = []} = await fbApi.post({
			uuid: post.uuid,
			html: post.rendered.html,
			published: false, // dry run, we actually publish it later
			wait: true,
		});

		// Ensure dry run post is deleted - we don't want it to hang around on prod, and
		// there's no associated import status to give meaningful information
		await fbApi.delete(post);

		if(errors.length) {
			const actualErrors = errors.filter(({level}) => level === 'ERROR');
			if(actualErrors.length) {
				post.error = actualErrors.map(({message}) => message);
				return false;
			}

			const nonDevWarnings = errors.filter(({message}) =>
				!message.startsWith('Audience Optimization Tags are Disabled in Development Mode')
			);
			if(nonDevWarnings.length) {
				post.error = nonDevWarnings.map(({message}) => message);
				return false;
			}
		}
	} catch(e) {
		if(e.type === 'FbApiImportException') {
			post.error = e;
			return false;
		}

		throw e;
	}

	return true;
};

exports.partitionTestable = async function partitionTestable(posts) {
	const isDupe = exports.isDupeFactory();

	const [testable, untestable] = await partitionPromiseParallel(posts, async function isTestable(post) {
		if(!await exports.getPostCanonical(post)) {
			post.reason = 'it\'s not an article';
			return false;
		}

		if(await isDupe(post)) {
			post.reason = 'we\'ve seen it already';
			return false;
		}

		await exports.hydratePostWithArticle(post);

		if(!await exports.canRenderPost(post)) {
			post.reason = 'we couldn\'t render it';
			return false;
		}

		if(!await exports.canPublishPost(post)) {
			post.reason = 'we couldn\'t post it to facebook';
			return false;
		}

		return true;
	});

	return {testable, untestable};
};

exports.bucketAndPublish = async function bucketAndPublish(post) {
	const bucket = await exports.setWithBucket(post);
	if(bucket === 'test') {
		await articleModel.postAndSetStatus({
			article: post,
			published: mode.get() === 'production',
			wait: true,
			username: 'daemon',
			type: 'ab',
		});
	}
};

exports.getPostStats = post => database.getAbTestStats(post.canonical)
	.then(stats => stats || {})
	.then(stats => Object.assign(post, {stats}));

exports.getBuckets = () => database.getFBLinkPosts()
	.then(posts => posts.filter(post => post.bucket !== 'removed'))
	.then(posts => Promise.all(posts.map(exports.getPostStats)));

exports.setWithBucket = async function setWithBucket(post, testBucket = Math.random() < 0.5) {
	post.bucket = testBucket ? 'test' : 'control';
	await database.setFBLinkPost(post.canonical, post);
	return post.bucket;
};

exports.markRemoved = canonical => database.setFBLinkPost(canonical, {canonical, bucket: 'removed'});
