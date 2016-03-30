'use strict';

const database = require('../lib/database');
const fbApi = require('../lib/fbApi');

module.exports = (req, res, next) => {
	switch(req.params.action) {
		case 'wipe':
			return database.wipe()
				.then(result => res.send(`Database wiped: [${result}]`));
		case 'list':
			return fbApi.list({mode: 'development'})
				.then(result => res.json(result))
				.catch(next);
		case 'get':
			return fbApi.get({id: 1597333667252309})
				.then(result => res.json(result))
				.catch(next);
		case 'post':
			return fbApi.post({html: 'blah'})
				.then(result => res.json(result))
				.catch(next);
		case 'status':
			return fbApi.get({id: 565297526971006})
				.then(result => res.json(result))
				.catch(next);
		case 'delete':
			return fbApi.delete({id: 474757556051614})
				.then(result => res.json(result))
				.catch(next);
		default:
			res.sendStatus(404);
			break;
	}
};
