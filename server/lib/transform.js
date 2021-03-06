'use strict';

const xsltTransform = require('./xslt');
const cheerioTransforms = require('./transforms');
const handlebarsTransform = require('./handlebars').render;
const extractMainImage = require('./transforms/extractMainImage');
const getAnalyticsUrl = require('./analytics');
const validateArticleElements = require('./validator');
const getRelatedArticles = require('./related');
const RichError = require('./richError');
const mode = require('./mode').get();

const requiredParams = [
	'apiRecord',
	'canonical',
	'uuid',
	'date_editorially_published',
	'date_record_updated',
];

const lightSignupProduct = 'Facebook Instant';
const lightSignupMailinglist = 'facebook-instant';

const transformArticleBody = (apiRecord, options) => {
	if(!apiRecord.bodyHTML) {
		return Promise.reject(
			new RichError('Missing required [bodyHTML] field', {
				tags: {from: 'transformArticleBody'},
				extra: {apiRecord, options},
			})
		);
	}

	const xsltParams = {
		brightcoveAccountId: process.env.BRIGHTCOVE_ACCOUNT_ID,
		brightcovePlayerId: 'default',
	};

	return xsltTransform(
		apiRecord.bodyHTML,
		`${process.cwd()}/server/stylesheets/main.xsl`,
		xsltParams
	)
	.then(body => cheerioTransforms(body, options));
};

const getAnnotations = apiRecord => (apiRecord.annotations || [])
.map(annotation => annotation.prefLabel)
.join('; ');

const getTitle = apiRecord => apiRecord.title;

const getSubtitle = apiRecord =>
	(Array.isArray(apiRecord.summaries) ? apiRecord.summaries[0] : null);

const getAuthors = apiRecord => {
	const authors = apiRecord.metadata
		.filter(item => !!(item.taxonomy && item.taxonomy === 'authors'))
		.map(item => item.prefLabel);

	if(authors.length) return authors;

	// Somtimes there are no authors in the taxonomy. It's very sad but it's true.
	if(apiRecord.byline) {
		return [apiRecord.byline.replace(/^by\s+/i, '')];
	}

	return [];
};

const basicValidate = article => Promise.resolve()
.then(() => {
	const missing = requiredParams.filter(key => !article[key]);
	if(missing.length) {
		throw new RichError('Article is missing required keys', {
			extra: {article, missing},
		});
	}
});

module.exports = article => {
	const warnings = [];

	const params = {
		canonicalUrl: article.canonical,
		uuid: article.uuid,
		style: 'default',
		date_published: article.date_editorially_published,
		date_updated: article.date_record_updated,
		cookieChecker: (process.env.SHOW_COOKIE_CHECKER && process.env.NODE_ENV !== 'production'),
		lightSignupUrl: process.env.LIGHT_SIGNUP_URL || 'https://distro-light-signup.ft.com',
		lightSignupProduct,
		lightSignupMailinglist,
		enableLightSignup: (process.env.ENABLE_LIGHT_SIGNUP === 'true'),
	};

	return basicValidate(article)
	.then(() => Promise.all([
		transformArticleBody(article.apiRecord, {warnings, params}),
		getRelatedArticles(article.apiRecord),
	]))
	.then(([transformed$, relatedArticles]) => {
		try {
			validateArticleElements(transformed$, {warnings, params});
		} catch(e) {
			throw new RichError(e.message, {
				tags: {from: 'transform'},
				extra: {article, transformed$, warnings, params},
				// Setting statusCode < 500 prevents sending this error to Sentry when
				// running in the UI
				statusCode: 422,
			});
		}

		const mainImageHtml = extractMainImage(transformed$, {warnings, params});
		const analyticsUrl = getAnalyticsUrl(article);
		const body = transformed$.html();
		const fullParams = Object.assign(params, {
			body,
			mainImageHtml,
			analyticsUrl,
			relatedArticles,

			// Only add `op:tags` in production, to avoid "Audience Optimization Tags are
			// Disabled in Development Mode" warnings
			tags: (mode === 'production') && getAnnotations(article.apiRecord, {warnings, params}),

			title: getTitle(article.apiRecord, {warnings, params}),
			subtitle: getSubtitle(article.apiRecord, {warnings, params}),
			authors: getAuthors(article.apiRecord, {warnings, params}),
		});

		return handlebarsTransform(`${process.cwd()}/views/templates/article.html`, fullParams)
			.then(html => ({html, warnings}));
	});
};
