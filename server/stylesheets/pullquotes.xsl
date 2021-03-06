<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">

	<xsl:template match="//*[contains(concat(' ',normalize-space(@class),' '),' n-content-pullquote ')]">
		<aside>
			<xsl:apply-templates select="*[contains(concat(' ',normalize-space(@class),' '),' n-content-pullquote__content ')]/node()" />
		</aside>
	</xsl:template>

	<xsl:template match="//*[contains(concat(' ',normalize-space(@class),' '),' n-content-pullquote__footer ')]">
		<cite>
			<xsl:apply-templates />
		</cite>
	</xsl:template>

</xsl:stylesheet>
