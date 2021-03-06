'use strict';

const database = require('../lib/database');
const articleModel = require('../models/article');
const testUuids = require('../lib/testUuids');
const transform = require('../lib/transform');
const fbApi = require('../lib/fbApi');
const ftApi = require('../lib/ftApi');

module.exports = (req, res, next) => {
	const url = req.params.url;
	const action = req.params.action;
	const username = req.cookies.s3o_username;

	const renderJsonArticle = article => res.json(Object.assign(article, res.app.locals));

	if(!url) {
		throw Error(`Missing required parameter [url] for action [${action}].`);
	}

	return Promise.resolve()
	.then(() => {
		if(!action) {
			return articleModel.get(url)
				.then(article => res.render('index', {article, testUuids}));
		}

		switch(action) {
			case 'get':
				return articleModel.get(url)
					.then(renderJsonArticle)
					.catch(e => {
						if(e.type === 'FtApiContentMissingException') {
							return res.status(404).json({error: e.toString()});
						}
						throw e;
					});

			case 'db':
				return database.get(url)
					.then(article => res.json(article));

			case 'fb':
				return database.get(url)
					.then(article => fbApi.find({canonical: article.canonical}))
					.then(result => res.json(result));

			case 'transform':
				return articleModel.get(url)
					.then(transform)
					.then(({html, warnings}) => res.send(html));

			case 'update':
				return articleModel.get(url)
					.then(articleModel.update)
					.then(renderJsonArticle);

			case 'import':
				return articleModel.get(url)
					.then(article => transform(article)
						.then(({html, warnings}) => fbApi.post({uuid: article.uuid, html})
							.then(({id}) => articleModel.setImportStatus({article, id, warnings, username, type: 'ui'}))
						)
					)
					.then(renderJsonArticle);

			case 'publish':
				return articleModel.get(url)
					.then(article => transform(article)
						.then(({html, warnings}) => fbApi.post({uuid: article.uuid, html, published: true})
							.then(({id}) => articleModel.setImportStatus({article, id, warnings, username, type: 'ui', published: true}))
						)
					)
					.then(renderJsonArticle);

			case 'reingest':
				return articleModel.get(url)
					.then(article => ftApi.updateEs(article.uuid))
					.then(() => articleModel.get(url))
					.then(articleModel.update)
					.then(renderJsonArticle);

			case 'delete':
				return fbApi.delete({canonical: url})
					.then(() => articleModel.get(url))
					.then(article => articleModel.setImportStatus({article, username, type: 'ui-delete'}))
					.then(renderJsonArticle);

			default:
				throw Error(`Action [${action}] not recognised.`);
		}
	})
	.catch(next);
};
