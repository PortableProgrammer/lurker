class ExtLinks {
    static ExternalDomains = [
        { // XKCD
            expression: `xkcd\\.com`,
            should_fetch: true,
            post_only: false,
            fetch_transform: ((url) => url),
            link_data: function(url, data) {
                // The image is located in the #comic div and is in the format "//imgs.xkcd.com/comics/.*?"
                const expression = /<div id=\"comic\">.*?<img src=\"(.*?imgs\.xkcd\.com\/comics\/.*?)\".*?\/>/gis;
                const matches = [...data.matchAll(expression)];

                // We only care about the first match
                // and index 1 for the capture group
                if (matches[0] && matches[0][1]) {
                    return "https:" + matches[0][1];
                }

                return null;
            },
            post_data: function(url, data) {
                const returnData = {};
                
                if (url) {
                    returnData.post_hint = "image";
                    returnData.url = url;
                    returnData.thumbnail = returnData.url;
                    return returnData;
                }
                return null;
            },
            inline_replacement: ((url) => `<a href="${url}"><img class="inline" src="${url}"></a>`),
        },
        { // Generic imgur/reddit links
            // imgur.com, preview.reddi.it, i.redd.it, v.redd.it
            expression: `(?:imgur\\.com|(?:preview|[iv])\\.redd\\.it|imgs\\.xkcd\\.com)`,
            should_fetch: false,
            post_only: false,
            fetch_transform: ((url) => url),
            link_data: function(url, data) {
                return url;
            },
            post_data: function(url, data) {
                const returnData = {};
                returnData.url = url;
                const expression = /(?:gifv|mp4)/i;
                if (url.match(expression)) {
                    // Probably a gif / video
                    returnData.secure_media = { reddit_video: {} };
                    returnData.secure_media.reddit_video.fallback_url = 
                        returnData.secure_media.reddit_video.dash_url = 
                        returnData.secure_media.reddit_video.hls_url = 
                            url.replace(expression, 'mp4');
                    returnData.thumbnail = returnData.url;
                    returnData.preview = { images: [ { source: { url: returnData.thumbnail }}]};
                    returnData.post_hint = "hosted:video";
                } else {
                    // Probably just a normal image
                    returnData.post_hint = "image";
                }
                return returnData;
            },
            inline_replacement: function(url) {
                const expression = /(?:gifv|mp4)/i;
                const gifExpression = /gifv/i;
                if (url.match(expression)) {
                    // Probably a gif / video
                    // If it's a gifv, enable autoplay
                    return `<video controls muted data-dashjs-player preload="metadata" poster="${url}"${url.match(gifExpression) ? "autoplay" : ""}><source src="${url}"></video>`;
                } else {
                    // Probably just a normal image
                    return `<a href="${url}"><img class="inline" src="${url}"></a>`;
                }
            },
        },
        { // Old-style imgur gallery
            expression: `imgur\\.com\/a\/`,
            should_fetch: true,
            post_only: true,
            fetch_transform: ((url) => url.includes("/gallery") ? url : url + "/embed"),
            link_data: function(url, data) {
                return url;
            },
            post_data: function(url, data) {
                const returnData = {};
                returnData.url = url;
                const expression = /^\s+?images\s+?:\s+?(\{\"count\":\d+?,\"images\":\[\{.*\},?\]\})/gm;
                const matches = data.matchAll(expression);
                if (matches) {
                    const matchArray = Array.from(matches);
                    if (matchArray.length == 1) {
                        // Single-item, don't treat it as a gallery
                        const video_expression = /(?:gifv|mp4)/i;
                        JSON.parse(matchArray[0][1]).images.map((img) => {
                            if (img.ext.match(video_expression)) {
                                // Probably a gif / video
                                returnData.secure_media = { reddit_video: {} };
                                returnData.secure_media.reddit_video.fallback_url = 
                                    returnData.secure_media.reddit_video.dash_url = 
                                    returnData.secure_media.reddit_video.hls_url = 
                                        "https://i.imgur.com/" + img.hash + img.ext;
                                returnData.thumbnail = "https://i.imgur.com/" + img.hash + ".jpg";
                                returnData.preview = { images: [ { source: { url: returnData.thumbnail }}]};
                                returnData.post_hint = "hosted:video";
                            } else {
                                // Probably just a normal image
                                returnData.post_hint = "image";
                                returnData.url = "https://i.imgur.com/" + img.hash + ".jpg";
                            }
                        });
                    } else {
                        // Build a gallery with these images
                        returnData.is_gallery = true;
                        returnData.gallery_data = {
                            items: [],
                        };
                        matchArray.forEach((match) => {
                            JSON.parse(match[1]).images.map((img) => {
                                returnData.gallery_data.items.push({
                                    media_id: "https://i.imgur.com/" + img.hash + ".jpg",
                                });
                            });
                        });
                    }
                }
                
                return returnData;
            },
            inline_replacement: function(url) {
                return null;
            },
        },
        { // New-style imgur gallery
            expression: `imgur\\.com\/gallery\/`,
            should_fetch: true,
            post_only: true,
            fetch_transform: ((url) => url),
            link_data: function(url, data) {
                return url;
            },
            post_data: function(url, data) {
                const returnData = {};
                returnData.url = url;
                const expression = /http.{1,2}\/\/i\.imgur\.com\/\w+\.jpeg/g;
                // Build a gallery with these images
                returnData.is_gallery = true;
                returnData.gallery_data = {
                    items: [],
                };
                Array.from(new Set(data.match(expression))).forEach((match) => {
                    returnData.gallery_data.items.push({
                        media_id: match,
                    });
                });

                return returnData;
            },
            inline_replacement: function(url) {
                return null;
            },
        },
    ];

    static getExternalDomain(url) {
        let result = null;
        ExtLinks.ExternalDomains.forEach(d => {
            const expr = new RegExp(d.expression, "g")
            if (url.match(expr)) {
                result = d;
            }
        });
        return result;
    }

    static async fetchExternal(url) {
        return fetch(
                url,
                {
                    mode: "no-cors",
                }
            )
          .then((res) => res.text())
			.catch((err) => null);
    }

    static async parseExternalLink(url) {
        const domain = ExtLinks.getExternalDomain(url);
        if (domain) {
            var fetch_data = null;
            if (domain.should_fetch) {
                fetch_data = await ExtLinks.fetchExternal(domain.fetch_transform(url));
            }
            
            return domain.link_data(url, fetch_data);
        }

        return null;
    }

    static async parseExternalInlineLink(url) {
        const domain = ExtLinks.getExternalDomain(url);
        if (domain && !domain.post_only) {
            var fetch_data = null;
            if (domain.should_fetch) {
                fetch_data = await ExtLinks.fetchExternal(domain.fetch_transform(url));
            }

            const link_data = domain.link_data(url, fetch_data);
            const inline_replacement = domain.inline_replacement(link_data);
            return inline_replacement;
        }

        return null;
    }

    static async parseExternalPost(post) {
        if (post.url) {
            const domain = ExtLinks.getExternalDomain(post.url);
            if (domain) {
                const link_data = await ExtLinks.parseExternalLink(post.url);
                if (link_data) {
                    var fetch_data = null;

                    if (domain.post_only) {
                        if (domain.should_fetch) {
                            fetch_data = await ExtLinks.fetchExternal(domain.fetch_transform(post.url));
                        }
                        else {
                            fetch_data = post.secure_media_embed;
                        }
                    }

                    return domain.post_data(link_data, fetch_data);
                }
            }
        }

        return null;
    }

    static async resolveExternalInlineLinks(html) {
        const expression = /<a.?href="(http[s]?:\/\/.*?)".*?>\1<\/a>/g;
        const matches = Array.from(html.matchAll(expression));

        var result = html;
        for (var i = 0; i < matches.length; i++) {
            const match = matches[i];
            const replacement = await ExtLinks.parseExternalInlineLink(match[1]);
            if (replacement) {
                result = result.replace(match[0], replacement);
            }
        }

        return result;
    }

    static async resolveExternalLinks(post) {
        // First, check for a link post
        if (post.post_hint == 'link') {
            const data = await ExtLinks.parseExternalPost(post);
            if (data) {
                return data;
            }
        }

        // Otherwise, if the first thing in this self post is a link, or it's only a link or a group of links, treat it as a link post
        // Easier to perform the regex on the markdown instead of the HTML version
        if (post.selftext) {
            const expression = /^\[(.*?)\]\(\1?\)/g;
            const matches = Array.from(post.selftext.matchAll(expression));

            if (matches.length > 0) {
                // Treat this as a link post with the first match
                post.post_hint = 'link';
                post.url = matches[0][1];
                const data = await ExtLinks.parseExternalPost(post);
                if (data) {
                    // Strip out the matching link from the self text
                    data.selftext = post.selftext.replace(`[${post.url}](${post.url})`, '');
                    const expr = new RegExp(`(<|&lt;)a href="${post.url}"(>|&gt;)${post.url}(<|&lt;)/a(>|&gt;)`, "g")
                    data.selftext_html = post.selftext_html.replace(expr, '');
                }

                return data;
            }
        }

        // Finally, find all anchors that href to known domains and contain just a link to the same href
        if (post.selftext_html) {
            const result = await ExtLinks.resolveExternalInlineLinks(post.selftext_html);

            if (result) {
                return { selftext_html: result };
            }
        }

        return null;
    }
}

export { ExtLinks };