class ExtLinks {
    static ExternalDomains = [
        {
            expression: `xkcd\\.com`,
            should_fetch: true,
            fetch_transform: ((post) => post.url),
            function: function(url, data) {
                const returnData = {};
                // The image is located in the #comic div and is in the format "//imgs.xkcd.com/comics/.*?"
                const expression = /<div id=\"comic\">.*?<img src=\"(.*?imgs\.xkcd\.com\/comics\/.*?)\".*?\/>/gis;
                const matches = [...data.matchAll(expression)];

                // We only care about the first match
                // and index 1 for the capture group
                if (matches[0] && matches[0][1]) {
                    returnData.post_hint = "image";
                    returnData.url = "https:" + matches[0][1];
                    returnData.thumbnail = returnData.url;
                    return returnData;
                }
                return null;
            },
        },
        {
            expression: `imgur\\.com`,
            should_fetch: false,
            fetch_transform: ((post) => post.url),
            function: function(url, data) {
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
                    returnData.post_hint = "hosted:video";
                } else {
                    // Probably just a normal image
                    returnData.post_hint = "image";
                }
                return returnData;
            },
        },
        {
            expression: `imgur\\.com\/a\/`,
            should_fetch: true,
            fetch_transform: ((post) => post.url.includes("/gallery") ? post.url : post.url + "/embed"),
            function: function(url, data) {
                const returnData = {};
                returnData.url = url;
                const expression = /^\s+?images\s+?:\s+?(\{\"count\":\d+?,\"images\":\[\{.*\},?\]\})/gm;
                data.matchAll(expression).forEach((match) => {
                    // Build a gallery with these images
                    returnData.is_gallery = true;
                    returnData.gallery_data = {
                        items: [],
                    };
                    JSON.parse(match[1]).images.map((img) => {
                        returnData.gallery_data.items.push({
                            media_id: "https://i.imgur.com/" + img.hash + ".jpg",
                        });
                    });
                });
                
                return returnData;
            },
        },
        {
            expression: `imgur\\.com\/gallery\/`,
            should_fetch: true,
            fetch_transform: ((post) => post.url),
            function: function(url, data) {
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

    static async parseExternal(post) {
        const domain = ExtLinks.getExternalDomain(post.url);
        if (domain) {
            if (domain.should_fetch) {
                const data = await ExtLinks.fetchExternal(domain.fetch_transform(post));

                if (data) {
                    const result = domain.function(post.url, data);
                    return result;
                }
            } else {
                const result = domain.function(post.url, post.secure_media_embed);
                return result;
            }
        }

        return null;
    }

    static async resolveExternalLinks(post) {
        if (post.url) {
            const data = await ExtLinks.parseExternal(post);
            if (data) {
                return data;
            }
        } 
        return null;
    }

    static updatePost(post, data) {
        // Update the post approrpriately
        post = Object.assign(post, data);
    }
}

export { ExtLinks };