const express = require("express");
const he = require("he");
const { hash, compare } = require("bun");
const jwt = require("jsonwebtoken");
const geddit = require("../geddit.js");
const { JWT_KEY } = require("../");
const { db } = require("../db");
const { authenticateToken } = require("../auth");

const router = express.Router();
const G = new geddit.Geddit();

// GET /
router.get("/", authenticateToken, async (req, res) => {
	res.render("home");
});

// GET /r/:id
router.get("/r/:subreddit", authenticateToken, async (req, res) => {
	const subreddit = req.params.subreddit;
	const isMulti = subreddit.includes("+");
	const query = req.query ? req.query : {};
	if (!query.sort) {
		query.sort = "hot";
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

	res.render("index", {
		subreddit,
		posts,
		about,
		query,
		isMulti,
		user: req.user,
		isSubbed,
	});
});

// GET /comments/:id
router.get("/comments/:id", authenticateToken, async (req, res) => {
	const id = req.params.id;

	const params = {
		limit: 50,
	};
	response = await G.getSubmissionComments(id, params);

	res.render("comments", {
		data: unescape_submission(response),
		user: req.user,
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
		const comments = response.comments;
		comments.forEach(unescape_comment);
		res.render("single_comment_thread", {
			comments,
			parent_id,
			user: req.user,
		});
	},
);

// GET /subs
router.get("/subs", authenticateToken, async (req, res) => {
	const subs = db
		.query("SELECT * FROM subscriptions WHERE user_id = $id")
		.all({ id: req.user.id });
	res.render("subs", { subs, user: req.user });
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

router.get("/register", async (req, res) => {
	res.render("register");
});

router.post("/register", async (req, res) => {
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
		const insertedRecord = db
			.query(
				"INSERT INTO users (username, password_hash) VALUES ($username, $hashedPassword)",
			)
			.run({
				username,
				hashedPassword,
			});
		const id = insertedRecord.lastInsertRowid;
		const token = jwt.sign({ username, id }, JWT_KEY, { expiresIn: "100h" });
		res
			.status(200)
			.cookie("auth_token", token, {
				httpOnly: true,
				maxAge: 2 * 24 * 60 * 60 * 1000,
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
			expiresIn: "1h",
		});
		res
			.cookie("auth_token", token, {
				httpOnly: true,
				maxAge: 2 * 24 * 60 * 60 * 1000,
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
		console.log("done");
		res.status(200).send("Unsubscribed successfully");
	} else {
		console.log("not");
		res.status(400).send("Subscription not found");
	}
});

module.exports = router;

function unescape_submission(response) {
	const post = response.submission.data;
	const comments = response.comments;

	if (post.selftext_html) {
		post.selftext_html = he.decode(post.selftext_html);
	}
	comments.forEach(unescape_comment);

	return { post, comments };
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
