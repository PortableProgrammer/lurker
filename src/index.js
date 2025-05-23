const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const app = express();
const hasher = new Bun.CryptoHasher("sha256", "secret-key");
const JWT_KEY = hasher.update(Math.random().toString()).digest("hex");

module.exports = { JWT_KEY };

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

const trust_proxy = process.env.LURKER_TRUST_PROXY || false;
if (trust_proxy) {
	app.set('trust proxy', process.env.LURKER_PROXY_COUNT || 1);
}
const routes = require("./routes/index");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "assets")));
app.use(cookieParser());
app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000,
		max: 100,
		message: "Too many requests from this IP, please try again later.",
		standardHeaders: true,
		legacyHeaders: false,
	}),
);
app.use("/", routes);

const port = process.env.LURKER_PORT;
const server = app.listen(port ? port : 3000, "0.0.0.0", () => {
	console.log("started on", server.address());
});

process.on('SIGTERM', () => {
	console.log('SIGTERM signal received: closing HTTP server');
	server.close(() => {
		console.log('HTTP server closed')
	});
});
