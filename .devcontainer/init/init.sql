/* Create a debug admin user
 * User: debug
 * Pass: test
INSERT INTO users (username, password_hash, isAdmin) 
VALUES ('debug', '$argon2id$v=19$m=65536,t=2,p=1$Wk4wtKV3dv4IraDG2bq5cif5bIfmt8oRElEqAxk9AXY$LlUNVKfc/ivAqgEFYLgDqIgV76z2Gg35j2yl6cPf3UA', 1)
 */

/* Toggle preferences
[card | compact]
UPDATE users SET pref_view = 'card' WHERE id = 1

[hot | best | new | rising | top | top&t=day | top&t=week | top&t=month | top&t=year | top&t=all]
UPDATE users SET pref_sort = 'best' WHERE id = 1

[0 | 1]
UPDATE users SET pref_collapseAutoMod = 1 WHERE id = 1

UPDATE users SET pref_trackSessions = 1 WHERE id = 1
 */

/* Subscribe  to some subreddits
INSERT INTO subscriptions (user_id, subreddit) VALUES
(1, '3dshacks'),
(1, 'ATBGE'),
(1, 'AdviceAnimals'),
(1, 'Audi'),
(1, 'CatastrophicFailure'),
(1, 'CityPorn'),
(1, 'Colorado'),
(1, 'DMAcademy'),
(1, 'EarthPorn'),
(1, 'F1Porn'),
(1, 'F1Technical'),
(1, 'FinalFantasy'),
(1, 'Greyhounds'),
(1, 'HistoryPorn'),
(1, 'HomeServer'),
(1, 'IAmA'),
(1, 'ImaginaryArchitecture'),
(1, 'ImaginaryCityscapes'),
(1, 'ImaginaryLandscapes'),
(1, 'ImaginaryTechnology'),
(1, 'JRPG'),
(1, 'Justrolledintotheshop'),
(1, 'MadeMeSmile'),
(1, 'MilitaryPorn'),
(1, 'MinimalWallpaper'),
(1, 'MobileWallpaper'),
(1, 'PleX'),
(1, 'PowerShell'),
(1, 'ProgrammerHumor'),
(1, 'RetroArch'),
(1, 'RetroPie'),
(1, 'Roms'),
(1, 'Shitty_Car_Mods'),
(1, 'StarWars'),
(1, 'ThatLookedExpensive'),
(1, 'TopGear'),
(1, 'WhatsWrongWithYourDog'),
(1, 'adhdmeme'),
(1, 'apple'),
(1, 'battlemaps'),
(1, 'bestof'),
(1, 'books'),
(1, 'comics'),
(1, 'criticalrole'),
(1, 'csharp'),
(1, 'cyberpunkgame'),
(1, 'dndmaps'),
(1, 'dndmemes'),
(1, 'docker'),
(1, 'dotnet'),
(1, 'emulation'),
(1, 'food'),
(1, 'formula1'),
(1, 'formuladank'),
(1, 'funny'),
(1, 'gaming'),
(1, 'gifs'),
(1, 'homelab'),
(1, 'horizon'),
(1, 'iOSBeta'),
(1, 'ios'),
(1, 'iphonewallpapers'),
(1, 'k3s'),
(1, 'kubernetes'),
(1, 'longboyes'),
(1, 'macgaming'),
(1, 'macos'),
(1, 'macosbeta'),
(1, 'news'),
(1, 'pics'),
(1, 'printSF'),
(1, 'raspberry_pi'),
(1, 'reddit'),
(1, 'rpg'),
(1, 'science'),
(1, 'scifi'),
(1, 'selfhosted'),
(1, 'softwaregore'),
(1, 'spaceporn'),
(1, 'sysadmin'),
(1, 'talesfromtechsupport'),
(1, 'technology'),
(1, 'techsupportgore'),
(1, 'techsupportmacgyver'),
(1, 'thegrandtour'),
(1, 'thewholecar'),
(1, 'tiltshift'),
(1, 'todayilearned'),
(1, 'urbanexploration'),
(1, 'ubiquiti'),
(1, 'wallpaper'),
(1, 'wallpapers'),
(1, 'windowsinsiders'),
(1, 'worldnews'),
(1, 'xkcd')
 */

/* Create some multireddits
INSERT INTO multireddits (user_id, multireddit, subreddit) VALUES
(1, 'F1', 'formula1'),
(1, 'F1', 'formuladank'),
(1, 'F1', 'f1technical'),
(1, 'F1', 'f1porn'),
(1, 'Homelab', 'homelab'),
(1, 'Homelab', 'selfhosted'),
(1, 'Homelab', 'homeserver'),
(1, 'Homelab', 'k3s'),
(1, 'Homelab', 'raspberry_pi'),
(1, 'Homelab', 'docker')
 */