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
	const qs = req.query && req.query.length > 0 ? ('?' + new URLSearchParams(req.query).toString()) : '';
	res.redirect(`/home${qs}`);
});

// GET /home
router.get("/home", authenticateToken, async (req, res) => {
	const subs = db
		.query("SELECT * FROM subscriptions WHERE user_id = $id")
		.all({ id: req.user.id });

	const qs = req.query && req.query.length > 0 ? ('?' + new URLSearchParams(req.query).toString()) : '';

	if (subs.length === 0) {
		res.redirect(`/r/all${qs}`);
	} else {
		const p = subs.map((s) => s.subreddit).join("+");
		renderIndex(p, req, res);
	}
});

// GET /r/:id
router.get("/r/:subreddit", authenticateToken, async (req, res) => {
	const subreddit = req.params.subreddit;

	renderIndex(subreddit, req, res);
});

// GET /m/:id
router.get("/m/:multireddit", authenticateToken, async(req, res) => {
	const multireddit = req.params.multireddit;
	const multi_sub = db
		.query("SELECT * FROM multireddits WHERE user_id = $id AND multireddit = $multireddit COLLATE NOCASE")
		.all({ id: req.user.id, multireddit: multireddit });
	const subs = multi_sub.map((s) => s.subreddit).join("+");

	if (multi_sub.length > 0) {
		req.query.lurker_multi = multi_sub[0].multireddit;
		renderIndex(subs, req, res);
	}
	else {
		const qs = req.query && req.query.length > 0 ? ('?' + new URLSearchParams(req.query).toString()) : '';
		res.redirect(`/${qs}`);
	}
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
			from: req.query.from,
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

	const multis = db
		.query(
			"SELECT DISTINCT multireddit FROM multireddits WHERE user_id = $id ORDER by LOWER(multireddit)",
		)
		.all({ id: req.user.id });

	res.render("subs", { 
		subs,
		multis,
		user: req.user,
	});
});

// GET /multi-create
router.get("/multi-create", authenticateToken, async (req, res) => {
	const multireddit = req.query.m;
	var items, after, message, multi_exists;
	if (multireddit) {
		multi_exists = db
			.query("SELECT * FROM multireddits WHERE user_id = $id AND multireddit = $multireddit COLLATE NOCASE")
			.get({ id: req.user.id, multireddit: multireddit }) !== null;
	}
	
	// If this multi already exists, or at least a name has been entered, redirect to multi-edit instead
	if (multi_exists || req.query.q) {
		const qs = req.query && req.query.length > 0 ? ('?' + new URLSearchParams(req.query).toString()) : '';
		res.redirect(`/multi-edit/${multireddit}${qs}`);
	}
	else {
		res.render("multireddit", { 
			mode: 'create',
			user: req.user,
			multireddit: multireddit,
			original_query: req.query.q,
			items,
			message,
		});
	}
});

// GET /multi-edit
router.get("/multi-edit/:multireddit", authenticateToken, async (req, res) => {
	var multireddit = req.params.multireddit;
	
	const multi_sub = db
		.query("SELECT * FROM multireddits WHERE user_id = $id AND multireddit = $multireddit COLLATE NOCASE")
		.all({ id: req.user.id, multireddit: multireddit });

	if (multi_sub && multi_sub.length > 0) {
		multireddit = multi_sub[0].multireddit;
	}

	var items, after, message;

	if (req.query && req.query.q) {
		var { items, after } = await G.searchSubreddits(req.query.q);
		message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;
	}

	res.render("multireddit", {
		mode: 'edit',
		multireddit,
		subs: multi_sub,
		original_query: req.query.q,
		user: req.user,
		message,
		items,
	});

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
		const prefs = get_user_prefs(req.user.id);
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
			prefs,
		});
	}
});

// GET /post-search
router.get("/post-search", authenticateToken, async (req, res) => {
	const prefs = get_user_prefs(req.user.id);
	if (!req.query || !req.query.q) {
		res.render("post-search", { user: req.user });
	} else {
		const { items, after } = await G.searchSubmissions(req.query.q);
		const message =
			items.length === 0
				? "no results found"
				: `showing ${items.length} results`;

		if (prefs.view == 'card' && items) {
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
			prefs,
		});
	}
});

// GET /dashboard
router.get("/dashboard", authenticateToken, async (req, res) => {
	const data = get_dashboard_data(req);
	res.render("dashboard", data);
});

// POST /dashboard
router.post("/dashboard", authenticateToken, async (req, res) => {
	// Get the default dashboard data
	const data = get_dashboard_data(req);

	// Update user record
	let message = null;
	let error = null;

	const password_current = req.body.password_current || '';
	const password_new = req.body.password_new || '';
	const password_confirm = req.body.password_confirm || '';
	const username = req.body.username_new || '';

	if (!password_new && !password_confirm && !username) {
		error = 'Nothing to update';
	}
	else {
		// Validate the current password before any updates
		const user = db
			.query("SELECT password_hash FROM users WHERE id = $user_id")
			.get({ user_id: req.user.id });
		if (!user || !(await Bun.password.verify(password_current, user.password_hash))) {
			error = 'Invalid current password';
		}
	}

	// Check for password update
	if (!error && req.body.password_new && req.body.password_confirm) {
		// Ensure the new and confirm passwords match
		if (password_new !== password_confirm) {
			error = 'New passwords do not match';
		}
		else {
			// Valid password; hash and update
			const hashedPassword = await Bun.password.hash(password_new);
			db.query(`
				UPDATE users
				SET password_hash = $hash
				WHERE id = $user_id
			`).run({ user_id: req.user.id, hash: hashedPassword });
			message = 'Updated password';
		}
	}

	// Check for username update
	let token = null;
	if (!error && req.body.username_new) {
		// Ensure this username is not in use
		const user = db
			.query("SELECT * FROM users WHERE username = $username")
			.get({ username });
		if (user) {
			error = `User "${username}" already exists`;
		}
		else {
			// Update the username and reissue the auth token
			db.query(`
				UPDATE users
				SET username = $username
				WHERE id = $user_id
			`).run({ user_id: req.user.id, username: username });

			token = jwt.sign({ username, id: req.user.id }, JWT_KEY, {
				expiresIn: "5d",
			});

			// Update the data with the new user and token
			data.user = jwt.verify(token, JWT_KEY);

			message = 'Updated username';
		}
	}

	if (token) {
		res.cookie("auth_token", token, {
			httpOnly: true,
			maxAge: 5 * 24 * 60 * 60 * 1000,
		}).render("dashboard", { ...data, message, error });
	}
	else {
		res.render("dashboard", { ...data, message, error });
	}
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
		return res.redirect(`/dashboard`);
	} catch (err) {
		console.log(err);
		return res.redirect(`/dashboard`);
	}
});

router.get("/delete-invite/:id", authenticateToken, async (req, res) => {
	try {
		db.run("DELETE FROM invites WHERE id = $id", { id: req.params.id });
		return res.redirect(`/dashboard`);
	} catch (err) {
		console.log(err);
		return res.redirect(`/dashboard`);
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
	const validPrefs = ['sort', 'view', 'collapseAutoMod', 'trackSessions']
	
	if (validPrefs.includes(preference)) {
		var query = `
			UPDATE users
			SET pref_${preference} = $value
			WHERE id = $user_id
		`;
		db.query(query).run({ user_id: user.id, value: value });
		res.status(200).send("Updated successfully");
	}
	else {
		res.status(400).send("Invalid preference");
	}
});

// POST /multi-add
router.post("/multi-add", authenticateToken, async (req, res) => {
	const { multireddit, subreddit } = req.body;
	const user = req.user;

	db.query(`
		INSERT INTO multireddits (user_id, multireddit, subreddit)
		VALUES ($user_id, $multireddit, $subreddit)
	`)
	.run({ user_id: user.id, multireddit: multireddit, subreddit: subreddit });

	res.status(200).send("Added successfully");
});

// POST /multi-remove
router.post("/multi-remove", authenticateToken, async (req, res) => {
	const { multireddit, subreddit } = req.body;
	const user = req.user;

	db.query(`
		DELETE FROM multireddits
		WHERE user_id = $user_id
			AND multireddit = $multireddit
			AND subreddit = $subreddit
	`)
	.run({ user_id: user.id, multireddit: multireddit, subreddit: subreddit });

	res.status(200).send("Removed successfully");
});

module.exports = router;

function get_dashboard_data(req) {
	let invites = null;
	let users = null;
	const isAdmin = db
		.query("SELECT isAdmin FROM users WHERE id = $id and isAdmin = 1")
		.get({
			id: req.user.id,
		});
	if (isAdmin) {
		invites = db
			.query("SELECT * FROM invites ORDER BY createdAt DESC")
			.all()
			.map((inv) => ({
				...inv,
				createdAt: Date.parse(inv.createdAt),
				usedAt: Date.parse(inv.usedAt),
			}));
		
		users = db
			.query(`SELECT * FROM users ORDER BY isAdmin DESC, username`)
			.all();
	}

	const prefs = get_user_prefs(req.user.id);

	return {
		user: req.user,
		invites,
		users,
		isAdmin,
		prefs,
	};
}

async function renderIndex(subreddit, req, res) {
	const multireddit = req.query.lurker_multi;
	const isMulti = subreddit.includes("+") || multireddit;
	const query = req.query ? req.query : {};

	const prefs = get_user_prefs(req.user.id);

	let isSubbed = false;
	if (!isMulti) {
		isSubbed =
			db
				.query(
					"SELECT * FROM subscriptions WHERE user_id = $id AND subreddit = $subreddit",
				)
				.get({ id: req.user.id, subreddit }) !== null;
	}
	const postsReq = G.getSubmissions(prefs.sort.split('&')[0], `${subreddit}`, { ...query, sort: prefs.sort });
	const aboutReq = G.getSubreddit(`${subreddit}`);

	// Track Sessions Performance logging
	const perfEvents = [];
	const perfStartTime = performance.now();
	var perfEventTime = performance.now();

	const [posts, about] = await Promise.all([postsReq, aboutReq]);

	if (about && about.public_description) {
		about.public_description = he.decode(about.public_description);
	}

	if (posts && prefs.trackSessions) {		
		// Capture the initial load event
		perfEvents.push({
			description: `Retrieved page of ${posts.posts.length} posts`,
			elapsed: performance.now() - perfEventTime,
		});

		perfEventTime = performance.now();
		// Reuse or create a new session
		let session = 
			db.query(`
				SELECT id, query 
				FROM sessions 
				WHERE user_id = $user_id AND subreddit = $subreddit
				ORDER BY id DESC
				LIMIT 1 OFFSET 0
			`).get({ user_id: req.user.id, subreddit: subreddit});

		perfEvents.push({
			description: `${session ? 'Retrieved' : 'Did not find'} session`,
			elapsed: performance.now() - perfEventTime,
		});

		// Create a new session if necessary
		if (!session || !req.query.after) {
			// Remove the old session and views
			if (session) {
				perfEventTime = performance.now();
				//Explicitly pass the session_id since it will have changed
				//by the time this is executed
				setTimeout(() => {
					// Remove prior session(s)
					// Which will cascade delete views
					db.query(`
						DELETE FROM sessions
						WHERE id IN (
							SELECT id FROM sessions
							WHERE user_id = $user_id
							ORDER BY id DESC
							LIMIT -1 OFFSET 1
						)
					`).run({ user_id: req.user.id });
				});

				perfEvents.push({
					description: 'Session outdated; scheduled for removal',
					elapsed: performance.now() - perfEventTime,
				});
			}

			perfEventTime = performance.now();
			// Create a new session for this subreddit and query
			session = 
				db.query(`
					INSERT INTO sessions (user_id, subreddit, query)
					VALUES ($user_id, $subreddit, $query)
					RETURNING id, query
				`).get({ user_id: req.user.id, subreddit: subreddit, query: posts.after });

			perfEvents.push({
				description: 'Created new session',
				elapsed: performance.now() - perfEventTime,
			});
		}

		// If we're on a different page,
		if (session.query != req.query.after) {
			perfEventTime = performance.now();
			// Get the views for this session
			let views = 
				db.query(`
					SELECT post_id FROM views WHERE session_id = $session_id
				`).all({ session_id: session.id });

			perfEvents.push({
				description: `Retrieved ${views.length} views from session`,
				elapsed: performance.now() - perfEventTime,
			});
	
			perfEventTime = performance.now();
			// Remove any previously-seen posts from this session
			let removedPosts = 0;
			let postsToRemove = new Set(views.map(view => view.post_id))
				.intersection(new Set(posts.posts.map(post => post.data.id)));

			perfEvents.push({
				description: `Got Set of ${postsToRemove.size || 0} duplicate post${(postsToRemove.size || 0) != 1 ? 's' : ''} to remove`,
				elapsed: performance.now() - perfEventTime,
			});
				
			perfEventTime = performance.now();
			
			for (const id of postsToRemove) {
				let index = posts.posts.findIndex((post) => post.data.id == id);
				if (index >= 0) {
					posts.posts.splice(index, 1);
					removedPosts++;
				}
			}

			perfEvents.push({
				description: `Removed ${removedPosts} duplicate post${removedPosts != 1 ? 's' : ''}`,
				elapsed: performance.now() - perfEventTime,
			});
	
			// Get more posts
			var perfLoopCounter = 0;
			var perfTotalRemoved = removedPosts;
			const perfStartLoopTime = performance.now();
			while (removedPosts > 0) {
				perfLoopCounter++;
				var perfLoopRemoved = 0;

				perfEventTime = performance.now();
				// Get up to double the number of removed posts, depending on how many we need
				let bufferFactor = (removedPosts > 10 ? 1.25 : removedPosts > 5 ? 1.5 : 2);
				let bufferLimit = Math.round(removedPosts * bufferFactor);

				const postsReq = G.getSubmissions(prefs.sort.split('&')[0], `${subreddit}`, { ...query, sort: prefs.sort, after: posts.after, limit: bufferLimit });
				const [extraPosts] = await Promise.all([postsReq]);
			
				// If we fail to retrieve any more posts, give up entirely and render the view
				if (!extraPosts) {
					break;
				}

				perfEvents.push({
					description: `[Loop ${perfLoopCounter}] Retrieved ${extraPosts.posts.length} extra post${extraPosts.posts.length != 1 ? 's' : ''}`,
					elapsed: performance.now() - perfEventTime,
				});

				perfEventTime = performance.now();
				// Remove any previously-seen posts from this session (including those we just pulled for this view)
				let postsToRemove = new Set(views.map(view => view.post_id))
					.union(new Set(posts.posts.map(post => post.data.id)))
					.intersection(new Set(extraPosts.posts.map(post => post.data.id)));

				perfEvents.push({
					description: `[Loop ${perfLoopCounter}] Got Set of ${postsToRemove.size || 0} duplicate extra posts to remove`,
					elapsed: performance.now() - perfEventTime,
				});
			
				perfEventTime = performance.now();
				for (const id of postsToRemove) {
					let index = extraPosts.posts.findIndex((post) => post.data.id == id);
					if (index >= 0) {
						extraPosts.posts.splice(index, 1);
						perfLoopRemoved++;
					}
				}

				perfEvents.push({
					description: `[Loop ${perfLoopCounter}] Removed ${perfLoopRemoved} duplicate extra posts`,
					elapsed: performance.now() - perfEventTime,
				});
			
				perfEventTime = performance.now();
				// Push these onto the end of the new posts, up to `removedPosts` times
				var c = 0;
				for (const post of extraPosts.posts) {
					if (removedPosts > 0) {
						posts.posts.push(post);
						// Update the `after` value
						posts.after = `${post.kind}_${post.data.id}`;
						// Decrement removedPosts counter
						removedPosts--;
						// Increment counter
						c++;
					}
					else {
						break;
					}
				}
				
				perfEvents.push({
					description:  `[Loop ${perfLoopCounter}] Pushed ${c} extra post${c != 1 ? 's' : ''}, need ${removedPosts} more post${removedPosts != 1 ? 's' : ''}`,
					elapsed: performance.now() - perfEventTime,
				});

				perfTotalRemoved += perfLoopRemoved;
			}

			if (perfLoopCounter > 0) {
				perfEvents.push({
					description: `Finished ${perfLoopCounter} loop${perfLoopCounter != 1 ? 's': ''}`,
					elapsed: performance.now() - perfStartLoopTime,
				});
			}

			perfEventTime = performance.now();
			// Update the session and insert the resulting set of views asynchronously
			setTimeout(() => {
				db.query(`
					UPDATE sessions
					SET query = $query
					WHERE id = $session_id
				`).run({ session_id: session.id, query: req.query.after });

				// Build the INSERT
				var q = 'INSERT INTO views (session_id, post_id) VALUES ';
				var p = {
					session_id: session.id,
				};
				var i = 0;
				posts.posts.forEach((post) => {
					q += `($session_id, $post_id_${i}), `;
					p[`post_id_${i}`] = post.data.id;
					i++;
				});
				db.query(q.trimEnd().replace(/,$/g, '')).run(p);
			});

			perfEvents.push({
				description: 'Scheduled update for session and views',
				elapsed: performance.now() - perfEventTime,
			});
		}

		perfEventTime = performance.now();
		// Schedule an optimize for long-running connnections: https://www.sqlite.org/pragma.html#pragma_optimize
		setTimeout(() => {
			db.run(`
				PRAGMA optimize;
			`);
		});

		perfEvents.push({
			description: `Scheduled SQLite optimize`,
			elapsed: performance.now() - perfEventTime,
		});

		perfEvents.push({
			description: `Replaced ${perfTotalRemoved || 0} duplicate post${(perfTotalRemoved || 0) != 1 ? 's': ''}`,
			elapsed: performance.now() - perfStartTime,
		});
	}

	if (prefs.view == 'card' && posts && posts.posts) {
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
		multireddit,
		posts,
		about,
		query,
		isMulti,
		user: req.user,
		isSubbed,
		currentUrl: req.url,
		prefs,
		perfEvents,
	});
}

function get_user_prefs(user_id) {
	const prefs = db.query(`
		SELECT pref_sort, pref_view, pref_collapseAutoMod, pref_trackSessions
		FROM users
		WHERE id = $user_id
	`)
	.all({ user_id: user_id })
	.map((pref) => ({
		sort: pref.pref_sort,
		view: pref.pref_view,
		collapseAutoMod: pref.pref_collapseAutoMod,
		trackSessions: pref.pref_trackSessions,
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
