const htmlparser = require("./htmlparser.js");

function extractLinks(html, baseUrl) {
	// Parse HTML to a DOM-like structure
	const handler = new htmlparser.HtmlBuilder(function(error) {
		if (error) console.error(error);
	});
	const parser = new htmlparser.Parser(handler);
	parser.parseComplete(html);
	const dom = handler.dom || [];

	const baseTagHref = findBaseHref(dom);
	const effectiveBaseUrl = baseTagHref || baseUrl;

	const videoExtensions = [".mp4"];

	const pageLinks = [];
	const videoLinks = [];

	// Recursively walk the DOM tree
	function walk(nodes) {
		if (!nodes) return;
		for (const node of nodes) {
			if (node.type === "tag") {
				const tag = node.name.toLowerCase();
				const attrs = node.attributes || {};

				if (tag === "a" && attrs.href) {
					const href = attrs.href.trim();
					if (
						!href.startsWith("#") &&
						!href.startsWith("javascript:") &&
						!href.startsWith("mailto:") &&
						!href.startsWith("tel:")
					) {
						const lowerHref = href.toLowerCase();
						if (!videoExtensions.some(ext => lowerHref.endsWith(ext))) {
							pageLinks.push(resolveUrl(href, effectiveBaseUrl));
						}
					}
				}

				if (tag === "video" && attrs.src) {
					videoLinks.push(resolveUrl(attrs.src, effectiveBaseUrl));
				}

				if (tag === "source") {
					if (attrs.src) {
						videoLinks.push(resolveUrl(attrs.src, effectiveBaseUrl));
					}
					if (attrs.srcset) {
						const parts = attrs.srcset.split(",").map(s => s.trim().split(" ")[0]);
						for (const src of parts) {
							videoLinks.push(resolveUrl(src, effectiveBaseUrl));
						}
					}
				}

				// Recursively process children
				if (node.children && node.children.length > 0) {
					walk(node.children);
				}
			}
		}
	}

	walk(dom);

	return {
		pageLinks,
		videoLinks
	};
}

function findBaseHref(dom) {
	for (const node of dom) {
		if (node.type === "tag" && node.name.toLowerCase() === "base" && node.attribs?.href) {
			return node.attribs.href;
		}
		if (node.children && node.children.length > 0) {
			const href = findBaseHref(node.children);
			if (href) return href;
		}
	}
	return undefined;
}

function resolveUrl(href, base) {
	try {
		return base ? new URL(href, base).toString() : href;
	} catch {
		return href;
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.handler = async (requestBody) => {
	const input = requestBody.payload;

	const start = new Date();

	let response = await fetch(input.path);
	let content = await response.text();

	const result = extractLinks(content, input.path);

	// Simulate work
	await sleep(2000);

	result.start = start;
	result.end = new Date();

	return {
		payload: result,
		next: undefined,
	};
};

