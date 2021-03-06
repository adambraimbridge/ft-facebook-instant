'use strict';

const expect = require('../../test-utils/expect');
const xslt = require('../../build/lib/xslt');

describe('big number transform', () => {
	const transform = input => xslt(input, `${process.cwd()}/server/stylesheets/main.xsl`);

	it('should transform n-content-big-number to aside with cite', () =>
		expect(transform(`<div class="n-content-big-number">
			<span class="n-content-big-number__title"><p>10.48m</p></span>
			<span class="n-content-big-number__content">
				<p>Record number of barrels a day that oil refiners raised processing runs to last year</p>
			</span>
		</div>`)).dom.to.eventually.equal(`<aside>
			<p>10.48m</p>
			<cite><p>Record number of barrels a day that oil refiners raised processing runs to last year</p></cite>
		</aside>`)
	);
});
