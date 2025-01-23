const express = require("express");
const he = require("he");
const jwt = require("jsonwebtoken");
const geddit = require("../geddit.js");
const extlinks = require("../extlinks.js");
const { JWT_KEY } = require("../");
const { db } = require("../db");
const { authenticateToken, authenticateAdmin } = require("../auth");
const { validateInviteToken } = require("../invite");
const url = require("url");

const router = express.Router();
const G = new geddit.Geddit();
const E = extlinks.ExtLinks;

// GET /
router.get("/", authenticateToken, async (req, res) => {
	const subs = db
		.query("SELECT * FROM subscriptions WHERE user_id = $id")
		.all({ id: req.user.id });

	const qs = req.query ? ('?' + new URLSearchParams(req.query).toString()) : '';

	if (subs.length === 0) {
		res.redirect(`/r/all${qs}`);
	} else {
		const p = subs.map((s) => s.subreddit).join("+");
		res.redirect(`/r/${p}${qs}`);
	}
});

// GET /r/:id
router.get("/r/:subreddit", authenticateToken, async (req, res) => {
	const subreddit = req.params.subreddit;
	const isMulti = subreddit.includes("+");
	const query = req.query ? req.query : {};

	const prefs = get_user_prefs(req.user.id);

	if (!query.sort) {
		query.sort = prefs.sort;
	}
	if (!query.view) {
		query.view = prefs.view;
	}

	let isSubbed = false;
	if (!isMulti) {
		isSubbed =
			db
				.query(
					"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
				)
				.get({ id: req.user.id, subreddit }) !== null;
	}
	const postsReq = G.getSubmissions(query.sort, `${subreddit}`, query);
	const aboutReq = G.getSubreddit(`${subreddit}`);

	const [posts, about] = await Promise.all([postsReq, aboutReq]);

	if (query.view == 'card' && posts && posts.posts) {
		posts.posts.forEach(unescape_selftext);
		posts.posts.forEach(unescape_media_embed);

		var extPromises = [];
		for (const post of posts.posts) {
			if (post.data.post_hint == 'link') {
				extPromises.push(E.resolveExternalLinks(post.data));
			} else {
				extPromises.push(null);
			}
		}
		const extResults = await Promise.all(extPromises);
		extResults.map((extData, i) => {
			if (extData) {
				E.updatePost(posts.posts[i].data, extData);
			}
		});
	}

	res.locals = {
		require_he: require("he"),
	};

	res.render("index", {
		subreddit,
		posts,
		about,
		query,
		isMulti,
		user: req.user,
		isSubbed,
		currentUrl: req.url,
	});
});

// GET /comments/:id
router.get("/comments/:id", authenticateToken, async (req, res) => {
	const id = req.params.id;

	const params = {
		limit: 50,
	};
	response = await G.getSubmissionComments(id, params);
	const prefs = get_user_prefs(req.user.id);

	const extData = await E.resolveExternalLinks(response.submission.data);
	if (extData) {
		E.updatePost(response.submission.data, extData);
	}

	res.locals = {
		require_he: require("he"),
	};

	res.render("comments", {
		data: unescape_submission(response),
		user: req.user,
		from: req.query.from,
		query: req.query,
		prefs,
	});
});

// GET /comments/:parent_id/comment/:child_id
router.get(
	"/comments/:parent_id/comment/:child_id",
	authenticateToken,
	async (req, res) => {
		const parent_id = req.params.parent_id;
		const child_id = req.params.child_id;

		const params = {
			limit: 50,
		};
		response = await G.getSingleCommentThread(parent_id, child_id, params);
		const prefs = get_user_prefs(req.user.id);
		const comments = response.comments;
		comments.forEach(unescape_comment);

		res.locals = {
			require_he: require("he"),
		};

		res.render("single_comment_thread", {
			comments,
			parent_id,
			user: req.user,
			prefs,
		});
	},
);

// GET /subs
router.get("/subs", authenticateToken, async (req, res) => {
	const subs = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id ORDER by LOWER(subreddit)",
		)
		.all({ id: req.user.id });

	res.render("subs", { subs, user: req.user, query: req.query });
});

// GET /search
router.get("/search", authenticateToken, async (req, res) => {
	res.render("search", { user: req.user, query: req.query });
});

// GET /sub-search
router.get("/sub-search", authenticateToken, async (req, res) => {
	if (!req.query || !req.query.q) {
		res.render("sub-search", { user: req.user });
	} else {
		const { items, after } = await G.searchSubreddits(req.query.q);
		const subs = db
			.query("SELECT subreddit FROM subscriptions WHERE user_id = $id")
			.all({ id: req.user.id })
			.map((res) => res.subreddit);
		const message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;
		res.render("sub-search", {
			items,
			subs,
			after,
			message,
			user: req.user,
			original_query: req.query.q,
			query: req.query,
		});
	}
});

// GET /post-search
router.get("/post-search", authenticateToken, async (req, res) => {
	if (!req.query || !req.query.q) {
		res.render("post-search", { user: req.user });
	} else {
		const { items, after } = await G.searchSubmissions(req.query.q);
		const message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;

		if (req.query.view == 'card' && items) {
			items.forEach(unescape_selftext);

			var extPromises = [];
			for (const post of items) {
				extPromises.push(E.resolveExternalLinks(post.data));
			}
			const extResults = await Promise.all(extPromises);
			extResults.map((extData, i) => {
				if (extData) {
					E.updatePost(items[i].data, extData);
				}
			});
		}
	
		res.locals = {
			require_he: require("he"),
		};
	
		res.render("post-search", {
			items,
			after,
			message,
			user: req.user,
			original_query: req.query.q,
			currentUrl: req.url,
			query: req.query,
		});
	}
});

// GET /dashboard
router.get("/dashboard", authenticateToken, async (req, res) => {
	let invites = null;
	const isAdmin = db
		.query("SELECT isAdmin FROM users WHERE id = $id and isAdmin = 1")
		.get({
			id: req.user.id,
		});
	if (isAdmin) {
		invites = db
			.query("SELECT * FROM invites")
			.all()
			.map((inv) => ({
				...inv,
				createdAt: Date.parse(inv.createdAt),
				usedAt: Date.parse(inv.usedAt),
			}));
	}

	const prefs = get_user_prefs(req.user.id);

	res.render("dashboard", { invites, isAdmin, user: req.user, query: req.query, prefs });
});

router.get("/create-invite", authenticateAdmin, async (req, res) => {
	function generateInviteToken() {
		const hasher = new Bun.CryptoHasher("sha256");
		return hasher.update(Math.random().toString()).digest("hex").slice(0, 10);
	}

	function createInvite() {
		const token = generateInviteToken();
		db.run("INSERT INTO invites (token) VALUES ($token)", { token });
	}

	try {
		createInvite();
		return res.redirect("/dashboard");
	} catch (err) {
		console.log(err);
		return res.send("failed to create invite");
	}
});

router.get("/delete-invite/:id", authenticateToken, async (req, res) => {
	try {
		db.run("DELETE FROM invites WHERE id = $id", { id: req.params.id });
		return res.redirect("/dashboard");
	} catch (err) {
		return res.send("failed to delete invite");
	}
});

// GET /media
router.get("/media/*", authenticateToken, async (req, res) => {
	const url = req.params[0];
	const ext = url.split(".").pop().toLowerCase();
	const kind = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
		? "img"
		: "video";
	res.render("media", { kind, url });
});

router.get("/register", validateInviteToken, async (req, res) => {
	res.render("register", { isDisabled: false, token: req.query.token });
});

router.post("/register", validateInviteToken, async (req, res) => {
	const { username, password, confirm_password } = req.body;

	if (!username || !password || !confirm_password) {
		return res.status(400).send("All fields are required");
	}

	const user = db
		.query("SELECT * FROM users WHERE username = $username")
		.get({ username });
	if (user) {
		return res.render("register", {
			message: `user by the name "${username}" exists, choose a different username`,
		});
	}

	if (password !== confirm_password) {
		return res.render("register", {
			message: "passwords do not match, try again",
		});
	}

	try {
		const hashedPassword = await Bun.password.hash(password);

		if (!req.isFirstUser) {
			db.query(
				"UPDATE invites SET usedAt = CURRENT_TIMESTAMP WHERE id = $id",
			).run({
				id: req.invite.id,
			});
		}

		const insertedRecord = db
			.query(
				"INSERT INTO users (username, password_hash, isAdmin) VALUES ($username, $hashedPassword, $isAdmin)",
			)
			.run({
				username,
				hashedPassword,
				isAdmin: req.isFirstUser ? 1 : 0,
			});
		const id = insertedRecord.lastInsertRowid;
		const token = jwt.sign({ username, id }, JWT_KEY, { expiresIn: "5d" });
		res
			.status(200)
			.cookie("auth_token", token, {
				httpOnly: true,
				maxAge: 5 * 24 * 60 * 60 * 1000,
			})
			.redirect("/");
	} catch (err) {
		return res.render("register", {
			message: "error registering user, try again later",
		});
	}
});

router.get("/login", async (req, res) => {
	res.render("login", req.query);
});

// POST /login
router.post("/login", async (req, res) => {
	const { username, password } = req.body;
	const user = db
		.query("SELECT * FROM users WHERE username = $username")
		.get({ username });
	if (user && (await Bun.password.verify(password, user.password_hash))) {
		const token = jwt.sign({ username, id: user.id }, JWT_KEY, {
			expiresIn: "5d",
		});
		res
			.cookie("auth_token", token, {
				httpOnly: true,
				maxAge: 5 * 24 * 60 * 60 * 1000,
			})
			.redirect(req.query.redirect || "/");
	} else {
		res.render("login", {
			message: "invalid credentials, try again",
		});
	}
});

// this would be post, but i cant stuff it in a link
router.get("/logout", (req, res) => {
	res.clearCookie("auth_token", {
		httpOnly: true,
		secure: true,
	});
	res.redirect("/login");
});

// POST /subscribe
router.post("/subscribe", authenticateToken, async (req, res) => {
	const { subreddit } = req.body;
	const user = req.user;
	const existingSubscription = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		)
		.get({ id: user.id, subreddit });
	if (existingSubscription) {
		res.status(400).send("Already subscribed to this subreddit");
	} else {
		db.query(
			"INSERT INTO subscriptions (user_id, subreddit) VALUES ($id, $subreddit)",
		).run({ id: user.id, subreddit });
		res.status(201).send("Subscribed successfully");
	}
});

router.post("/unsubscribe", authenticateToken, async (req, res) => {
	const { subreddit } = req.body;
	const user = req.user;
	const existingSubscription = db
		.query(
			"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		)
		.get({ id: user.id, subreddit });
	if (existingSubscription) {
		db.query(
			"DELETE FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
		).run({ id: user.id, subreddit });
		res.status(200).send("Unsubscribed successfully");
	} else {
		res.status(400).send("Subscription not found");
	}
});

// POST /set-pref
router.post("/set-pref", authenticateToken, async (req, res) => {
	const { preference, value} = req.body;
	const user = req.user;
	
	switch(preference) {
		case 'sort':
			db.query(`
				UPDATE users
				SET sortPref = $value
				WHERE id = $user_id
			`)
			.run({ user_id: user.id, value: value });
			break;

		case 'view':
			db.query(`
				UPDATE users
				SET viewPref = $value
				WHERE id = $user_id
			`)
			.run({ user_id: user.id, value: value });
			break;

		case 'collapseAutoMod':
			db.query(`
				UPDATE users
				SET collapseAutoModPref = $value
				WHERE id = $user_id
			`)
			.run({ user_id: user.id, value: value });
			break;
	}
	res.status(200).send("Updated successfully");
});

module.exports = router;

function get_user_prefs(user_id) {
	const prefs = db.query(`
		SELECT sortPref, viewPref, collapseAutoModPref
		FROM users
		WHERE id = $user_id
	`)
	.all({ user_id: user_id })
	.map((pref) => ({
		sort: pref.sortPref,
		view: pref.viewPref,
		collapseAutoMod: pref.collapseAutoModPref,
	}));
	
	return prefs[0];
}

function unescape_submission(response) {
	const post = response.submission.data;
	const comments = response.comments;

	unescape_selftext(post);
	comments.forEach(unescape_comment);

	return { post, comments };
}

function unescape_selftext(post) {
	// getSubmissions: post.data
	// getSubmissionComments: post
	const temp_post = post.data || post;
	if (temp_post.selftext_html) {
		temp_post.selftext_html = he.decode(temp_post.selftext_html);
	}
	// If this is a crosspost, recurse through the parents as well
	if (temp_post.crosspost_parent && temp_post.crosspost_parent_list && temp_post.crosspost_parent_list.length > 0) {
		temp_post.crosspost_parent_list.forEach(unescape_selftext);
	}
}

function unescape_comment(comment) {
	if (comment.data.body_html) {
		comment.data.body_html = he.decode(comment.data.body_html);
	}
	if (comment.data.replies) {
		if (comment.data.replies.data) {
			if (comment.data.replies.data.children) {
				comment.data.replies.data.children.forEach(unescape_comment);
			}
		}
	}
}

function unescape_media_embed(post) {
	// If called after getSubmissions
	if (post.data && post.data.secure_media_embed && post.data.secure_media_embed.content) {
		post.data.secure_media_embed.content = he.decode(post.data.secure_media_embed.content);
	}
	// If called after getSubmissionComments
	if (post.secure_media_embed && post.secure_media_embed.content) {
		post.secure_media_embed.content = he.decode(post.secure_media_embed.content);
	}
}
