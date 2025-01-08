class ExtLinks {
    static ExternalDomains = [
        {
            expression: `xkcd\\.com`,
            should_fetch: true,
            data: {
                post_hint: 'image',
                url: '',
                thumbnail: '',
            },
            function: function(url, data, returnData) {
                // The image is located in the #comic div and is in the format "//imgs.xkcd.com/comics/.*?"
                const expression = /<div id=\"comic\">.*?<img src=\"(.*?imgs\.xkcd\.com\/comics\/.*?)\".*?\/>/gis;
                const matches = [...data.matchAll(expression)];

                // We only care about the first match
                // and index 1 for the capture group
                if (matches[0] && matches[0][1]) {
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
            data: {
                post_hint: '',
                // For images
                url: '',
                thumbnail: '',
                // For video
                secure_media: {
                    reddit_video: {
                        dash_url: '',
                        hls_url: '',
                        fallback_url: '',
                    }
                },
            },
            function: function(url, data, returnData) {
                returnData.url = url;
                const expression = /(?:gifv|mp4)/i;
                if (url.match(expression)) {
                    returnData.secure_media.reddit_video.fallback_url = 
                        returnData.secure_media.reddit_video.dash_url = 
                        returnData.secure_media.reddit_video.hls_url = 
                            url.replace(expression, 'mp4');
                    returnData.thumbnail = returnData.url;
                    returnData.post_hint = "hosted:video";
                } else {
                    returnData.post_hint = "image";
                }
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

    static async parseExternal(url) {
        const domain = ExtLinks.getExternalDomain(url);
        if (domain) {
            if (domain.should_fetch) {
                const req = ExtLinks.fetchExternal(url);
                const data = await Promise.all([req]);

                if (data[0]) {
                    const result = domain.function(url, data[0], structuredClone(domain.data));
                    return result;
                }
            } else {
                const result = domain.function(url, null, structuredClone(domain.data));
                return result;
            }
        }

        return null;
    }

    static async resolveExternalLinks(post) {
        if (post.url) {
            let url = post.url;
            const req = ExtLinks.parseExternal(url);
            const data = await Promise.all([req]);
            if (data && data[0]) {
                return data[0];
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