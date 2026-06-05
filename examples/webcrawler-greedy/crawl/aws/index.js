"use strict";

const htmlparser = require("./htmlparser.js");

function extractLinks(html, baseUrl) {
  const handler = new htmlparser.HtmlBuilder((error) => {
    if (error) console.error(error);
  });
  const parser = new htmlparser.Parser(handler);
  parser.parseComplete(html);
  const dom = handler.dom || [];

  const base = findBaseHref(dom) || baseUrl;
  const pageLinks = [];
  const videoLinks = [];

  function walk(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type !== "tag") continue;
      const tag = node.name.toLowerCase();
      const attrs = node.attributes || {};

      if (tag === "a" && attrs.href) {
        const href = attrs.href.trim();
        if (
          !href.startsWith("#") &&
          !href.startsWith("javascript:") &&
          !href.startsWith("mailto:") &&
          !href.startsWith("tel:") &&
          !href.toLowerCase().endsWith(".mp4")
        ) {
          pageLinks.push(resolveUrl(href, base));
        }
      }

      if ((tag === "video" || tag === "source") && attrs.src) {
        videoLinks.push(resolveUrl(attrs.src, base));
      }

      if (node.children) walk(node.children);
    }
  }

  walk(dom);
  return { pageLinks, videoLinks };
}

function findBaseHref(dom) {
  for (const node of dom) {
    if (node.type === "tag" && node.name.toLowerCase() === "base" && node.attributes?.href)
      return node.attributes.href;
    if (node.children) {
      const found = findBaseHref(node.children);
      if (found) return found;
    }
  }
  return null;
}

function resolveUrl(href, base) {
  try {
    const url = base ? new URL(href, base).toString() : href;
    return url.replace(/\/$/, "");
  } catch { return href; }
}

exports.handler = async ({ payload }) => {
  const { url } = payload;
  const response = await fetch(url);
  const html = await response.text();
  const { pageLinks, videoLinks } = extractLinks(html, url);
  return { payload: { pageLinks, videoLinks } };
};
