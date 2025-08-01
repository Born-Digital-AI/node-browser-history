const path = require("path");
const fs = require("fs");
const Database = require("sqlite-async");
const uuidV4 = require("uuid").v4;

const browsers = require("./browsers");
const { tmpdir } = require("os");

/**
 * Get the path to the temp directory of
 * the current platform.
 */
function getTempDir() {
    return process.env.TMP || process.env.TMPDIR || tmpdir();
}

/**
 * Runs the the proper function for the given browser. Some browsers follow the same standards as
 * chrome and firefox others have their own syntax.
 * Returns an empty array or an array of browser record objects
 * @param paths
 * @param browserName
 * @param historyTimeLength
 * @returns {Promise<array>}
 */
async function getBrowserHistory(paths = [], browserName, historyTimeLength) {
    switch (browserName) {
        case browsers.FIREFOX:
        case browsers.SEAMONKEY:
            return getMozillaBasedBrowserRecords(paths, browserName, historyTimeLength);
        case browsers.CHROME:
        case browsers.OPERA:
        case browsers.TORCH:
        case browsers.VIVALDI:
        case browsers.BRAVE:
        case browsers.EDGE:
        case browsers.AVAST:
            return await getChromeBasedBrowserRecords(paths, browserName, historyTimeLength);

        case browsers.MAXTHON:
            return await getMaxthonBasedBrowserRecords(paths, browserName, historyTimeLength);
        default:
            return [];
    }
}

/**
 * Runs the proper function for the given browser to extract bookmarks.
 * Returns an empty array or an array of bookmark record objects
 * @param paths
 * @param browserName
 * @returns {Promise<array>}
 */
async function getBrowserBookmarks(paths = [], browserName) {
    switch (browserName) {
        case browsers.FIREFOX:
        case browsers.SEAMONKEY:
            return getMozillaBasedBrowserBookmarks(paths, browserName);
        case browsers.CHROME:
        case browsers.OPERA:
        case browsers.TORCH:
        case browsers.VIVALDI:
        case browsers.BRAVE:
        case browsers.EDGE:
        case browsers.AVAST:
            return await getChromeBasedBrowserBookmarks(paths, browserName);
        default:
            return [];
    }
}

async function getHistoryFromDb(dbPath, sql, browserName) {
    const db = await Database.open(dbPath);
    const rows = await db.all(sql);
    let browserHistory = rows.map(row => {
        return {
            title: row.title,
            utc_time: row.last_visit_time,
            url: row.url,
            browser: browserName,
        };
    });
    await db.close();
    return browserHistory;
}

/**
 * Extract bookmarks from database using provided SQL query
 * @param dbPath
 * @param sql
 * @param browserName
 * @returns {Promise<array>}
 */
async function getBookmarksFromDb(dbPath, sql, browserName) {
    const db = await Database.open(dbPath);
    const rows = await db.all(sql);
    let bookmarks = rows.map(row => {
        return {
            title: row.title,
            added_time: row.added_time,
            url: row.url,
            folder: row.folder || 'Unknown',
            browser: browserName,
        };
    });
    await db.close();
    return bookmarks;
}

function copyDbAndWalFile(dbPath, fileExtension = 'sqlite') {
    const newDbPath = path.join(getTempDir(), uuidV4() + `.${fileExtension}`);
    const filePaths = {};
    filePaths.db = newDbPath;
    filePaths.dbWal = `${newDbPath}-wal`;
    fs.copyFileSync(dbPath, filePaths.db);
    if (fs.existsSync(`${dbPath}-wal`)) {
        fs.copyFileSync(`${dbPath}-wal`, filePaths.dbWal);
    }
    return filePaths;
}

async function forceWalFileDump(tmpDbPath) {
    const db = await Database.open(tmpDbPath);

    // If the browser uses a wal file we need to create a wal file with the same filename as our temp database.
    await db.run("PRAGMA wal_checkpoint(FULL)");
    await db.close();
}

function deleteTempFiles(paths) {
    paths.forEach(path => {
        if (fs.existsSync(path)) {
            fs.unlinkSync(path);
        }
    });
}

async function getChromeBasedBrowserRecords(paths, browserName, historyTimeLength) {
    if (!paths || paths.length === 0) {
        return [];
    }
    let newDbPaths = [];
    let browserHistory = [];
    for (let i = 0; i < paths.length; i++) {
        let newDbPath = path.join(getTempDir(), uuidV4() + ".sqlite");
        newDbPaths.push(newDbPath);
        let sql = `SELECT title, datetime(last_visit_time/1000000 + (strftime('%s', '1601-01-01')),'unixepoch') last_visit_time, url from urls WHERE DATETIME (last_visit_time/1000000 + (strftime('%s', '1601-01-01')), 'unixepoch')  >= DATETIME('now', '-${historyTimeLength} minutes') group by title, last_visit_time order by last_visit_time`;
        //Assuming the sqlite file is locked so lets make a copy of it
        fs.copyFileSync(paths[i], newDbPath);
        browserHistory.push(await getHistoryFromDb(newDbPath, sql, browserName));
    }
    deleteTempFiles(newDbPaths);
    return browserHistory;
}

/**
 * Extract bookmarks from Chrome-based browsers
 * @param paths
 * @param browserName
 * @returns {Promise<array>}
 */
async function getChromeBasedBrowserBookmarks(paths, browserName) {
    if (!paths || paths.length === 0) {
        return [];
    }

    let allBookmarks = [];

    for (let i = 0; i < paths.length; i++) {
        // Chrome stores bookmarks in 'Bookmarks' file (JSON format) in the same directory as History
        const historyPath = paths[i];
        const bookmarksPath = path.join(path.dirname(historyPath), 'Bookmarks');

        if (fs.existsSync(bookmarksPath)) {
            try {
                const bookmarksJson = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
                const extractedBookmarks = extractChromeBookmarks(bookmarksJson, browserName);
                allBookmarks = allBookmarks.concat(extractedBookmarks);
            } catch (error) {
                console.error(`Error reading Chrome bookmarks from ${bookmarksPath}:`, error);
            }
        }
    }

    return allBookmarks;
}

/**
 * Recursively extract bookmarks from Chrome JSON structure
 * @param node
 * @param browserName
 * @param folder
 * @returns {array}
 */
function extractChromeBookmarks(node, browserName, folder = 'Unknown') {
    let bookmarks = [];

    if (node.roots) {
        // Root level - process bookmark_bar, other, synced, etc.
        for (const [key, value] of Object.entries(node.roots)) {
            if (value && typeof value === 'object') {
                const folderName = value.name || key;
                bookmarks = bookmarks.concat(extractChromeBookmarks(value, browserName, folderName));
            }
        }
    } else if (node.children && Array.isArray(node.children)) {
        // Process children
        for (const child of node.children) {
            if (child.type === 'url') {
                // This is a bookmark
                bookmarks.push({
                    title: child.name || 'Untitled',
                    added_time: new Date(parseInt(child.date_added) / 1000).toISOString(), // Chrome uses microseconds since Windows epoch
                    url: child.url,
                    folder: folder,
                    browser: browserName
                });
            } else if (child.type === 'folder') {
                // This is a folder, recurse into it
                bookmarks = bookmarks.concat(extractChromeBookmarks(child, browserName, child.name || 'Unknown'));
            }
        }
    }

    return bookmarks;
}

async function getMozillaBasedBrowserRecords(paths, browserName, historyTimeLength) {
    if (!paths || paths.length === 0) {
        return [];
    }
    let newDbPaths = [];
    let browserHistory = [];
    for (let i = 0; i < paths.length; i++) {
        const tmpFilePaths = copyDbAndWalFile(paths[i]);
        console.log(tmpFilePaths)
        newDbPaths.push(tmpFilePaths.db);
        let sql = `SELECT title, datetime(last_visit_date/1000000,'unixepoch') last_visit_time, url from moz_places WHERE DATETIME (last_visit_date/1000000, 'unixepoch')  >= DATETIME('now', '-${historyTimeLength} minutes')  group by title, last_visit_time order by last_visit_time`;
        await forceWalFileDump(tmpFilePaths.db);
        browserHistory.push(await getHistoryFromDb(tmpFilePaths.db, sql, browserName));
    }
    deleteTempFiles(newDbPaths);
    return browserHistory;
}

/**
 * Extract bookmarks from Mozilla-based browsers (Firefox, SeaMonkey)
 * @param paths
 * @param browserName
 * @returns {Promise<array>}
 */
async function getMozillaBasedBrowserBookmarks(paths, browserName) {
    if (!paths || paths.length === 0) {
        return [];
    }

    let newDbPaths = [];
    let allBookmarks = [];

    for (let i = 0; i < paths.length; i++) {
        const tmpFilePaths = copyDbAndWalFile(paths[i]);
        newDbPaths.push(tmpFilePaths.db);

        // Firefox stores bookmarks in the same places.sqlite file as history
        const bookmarksSQL = `
            SELECT
                datetime(
                    moz_bookmarks.dateAdded/1000000,'unixepoch','localtime'
                ) AS added_time,
                url, 
                moz_bookmarks.title, 
                moz_folder.title as folder
            FROM
                moz_bookmarks 
                JOIN moz_places ON moz_bookmarks.fk = moz_places.id
                JOIN moz_bookmarks as moz_folder ON moz_bookmarks.parent = moz_folder.id
            WHERE
                moz_bookmarks.dateAdded IS NOT NULL 
                AND url LIKE 'http%'
                AND moz_bookmarks.title IS NOT NULL
        `;

        try {
            await forceWalFileDump(tmpFilePaths.db);
            const bookmarks = await getBookmarksFromDb(tmpFilePaths.db, bookmarksSQL, browserName);
            allBookmarks = allBookmarks.concat(bookmarks);
        } catch (error) {
            console.error(`Error extracting bookmarks from ${browserName}:`, error);
        }
    }

    deleteTempFiles(newDbPaths);
    return allBookmarks;
}

async function getMaxthonBasedBrowserRecords(paths, browserName, historyTimeLength) {
    let browserHistory = [];
    for (let i = 0; i < paths.length; i++) {
        let sql = `SELECT zlastvisittime last_visit_time, zhost host, ztitle title, zurl url FROM zmxhistoryentry WHERE  Datetime (zlastvisittime + 978307200, 'unixepoch') >= Datetime('now', '-${historyTimeLength} minutes')`;
        browserHistory.push(await getHistoryFromDb(paths[i], sql, browserName));
    }
    return browserHistory;
}

// BOOKMARK FUNCTIONS

/**
 * Gets Firefox bookmarks
 * @returns {Promise<array>}
 */
async function getFirefoxBookmarks() {
    browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX);
    return getBrowserBookmarks(browsers.browserDbLocations.firefox, browsers.FIREFOX);
}

/**
 * Gets SeaMonkey bookmarks
 * @returns {Promise<array>}
 */
async function getSeaMonkeyBookmarks() {
    browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY);
    return getBrowserBookmarks(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY);
}

/**
 * Gets Chrome bookmarks
 * @returns {Promise<array>}
 */
async function getChromeBookmarks() {
    browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME);
    return getBrowserBookmarks(browsers.browserDbLocations.chrome, browsers.CHROME);
}

/**
 * Gets Opera bookmarks
 * @returns {Promise<array>}
 */
async function getOperaBookmarks() {
    browsers.browserDbLocations.opera = browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA);
    return getBrowserBookmarks(browsers.browserDbLocations.opera, browsers.OPERA);
}

/**
 * Gets Brave bookmarks
 * @returns {Promise<array>}
 */
async function getBraveBookmarks() {
    browsers.browserDbLocations.brave = browsers.findPaths(browsers.defaultPaths.brave, browsers.BRAVE);
    return getBrowserBookmarks(browsers.browserDbLocations.brave, browsers.BRAVE);
}

/**
 * Gets Vivaldi bookmarks
 * @returns {Promise<array>}
 */
async function getVivaldiBookmarks() {
    browsers.browserDbLocations.vivaldi = browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI);
    return getBrowserBookmarks(browsers.browserDbLocations.vivaldi, browsers.VIVALDI);
}

/**
 * Gets Microsoft Edge bookmarks
 * @returns {Promise<array>}
 */
async function getMicrosoftEdgeBookmarks() {
    browsers.browserDbLocations.edge = browsers.findPaths(browsers.defaultPaths.edge, browsers.EDGE);
    return getBrowserBookmarks(browsers.browserDbLocations.edge, browsers.EDGE);
}

/**
 * Gets AVAST Browser bookmarks
 * @returns {Promise<array>}
 */
async function getAvastBookmarks() {
    browsers.browserDbLocations.avast = browsers.findPaths(browsers.defaultPaths.avast, browsers.AVAST);
    return getBrowserBookmarks(browsers.browserDbLocations.avast, browsers.AVAST);
}

/**
 * Gets bookmarks from all supported browsers
 * @returns {Promise<array>}
 */
async function getAllBookmarks() {
    let allBookmarks = [];

    // Setup browser paths
    browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX);
    browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME);
    browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY);
    browsers.browserDbLocations.opera = browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA);
    browsers.browserDbLocations.brave = browsers.findPaths(browsers.defaultPaths.brave, browsers.BRAVE);
    browsers.browserDbLocations.vivaldi = browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI);
    browsers.browserDbLocations.edge = browsers.findPaths(browsers.defaultPaths.edge, browsers.EDGE);
    browsers.browserDbLocations.avast = browsers.findPaths(browsers.defaultPaths.avast, browsers.AVAST);

    // Get bookmarks from all browsers
    try {
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.firefox, browsers.FIREFOX));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.chrome, browsers.CHROME));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.opera, browsers.OPERA));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.brave, browsers.BRAVE));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.vivaldi, browsers.VIVALDI));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.edge, browsers.EDGE));
        allBookmarks = allBookmarks.concat(await getBrowserBookmarks(browsers.browserDbLocations.avast, browsers.AVAST));

        // Sort bookmarks by date added (newest first)
        allBookmarks.sort((a, b) => new Date(b.added_time) - new Date(a.added_time));
    } catch (error) {
        console.error('Error getting bookmarks:', error);
    }

    return allBookmarks.flat(); // Flatten in case any function returns nested arrays
}

// EXISTING HISTORY FUNCTIONS

/**
 * Gets Firefox history
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getFirefoxHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX);
    return getBrowserHistory(browsers.browserDbLocations.firefox, browsers.FIREFOX, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Gets Seamonkey History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
function getSeaMonkeyHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY);
    return getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Gets Chrome History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getChromeHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME);
    return getBrowserHistory(browsers.browserDbLocations.chrome, browsers.CHROME, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Opera History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getOperaHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.opera = browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA);
    return getBrowserHistory(browsers.browserDbLocations.opera, browsers.OPERA, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Torch History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getTorchHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.torch = browsers.findPaths(browsers.defaultPaths.torch, browsers.TORCH);
    return getBrowserHistory(browsers.browserDbLocations.torch, browsers.TORCH, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Brave History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getBraveHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.brave = browsers.findPaths(browsers.defaultPaths.brave, browsers.BRAVE);
    return getBrowserHistory(browsers.browserDbLocations.brave, browsers.BRAVE, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Maxthon History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getMaxthonHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.maxthon = browsers.findPaths(browsers.defaultPaths.maxthon, browsers.MAXTHON);
    return getBrowserHistory(browsers.browserDbLocations.maxthon, browsers.MAXTHON, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Vivaldi History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getVivaldiHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.vivaldi = browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI);
    return getBrowserHistory(browsers.browserDbLocations.vivaldi, browsers.VIVALDI, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get AVAST Browser History
 * @param historyTimeLength
 * @return {Promise<Array>}
 */
async function getAvastHistory(historyTimeLength = 5) {
    browsers.browserDbLocations.avast = browsers.findPaths(browsers.defaultPaths.avast, browsers.AVAST);
    return getBrowserHistory(browsers.browserDbLocations.avast, browsers.AVAST, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Get Microsoft Edge History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getMicrosoftEdge(historyTimeLength = 5) {
    browsers.browserDbLocations.edge = browsers.findPaths(browsers.defaultPaths.edge, browsers.EDGE);
    return getBrowserHistory(browsers.browserDbLocations.edge, browsers.EDGE, historyTimeLength).then(records => {
        return records;
    });
}

/**
 * Gets the history for the Specified browsers and time in minutes.
 * Returns an array of browser records.
 * @param historyTimeLength | Integer
 * @returns {Promise<array>}
 */
async function getAllHistory(historyTimeLength = 5) {
    let allBrowserRecords = [];

    browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX);
    browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME);
    browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY);
    browsers.browserDbLocations.opera = browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA);
    browsers.browserDbLocations.torch = browsers.findPaths(browsers.defaultPaths.torch, browsers.TORCH);
    browsers.browserDbLocations.brave = browsers.findPaths(browsers.defaultPaths.brave, browsers.BRAVE);
    browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY);
    browsers.browserDbLocations.maxthon = browsers.findPaths(browsers.defaultPaths.maxthon, browsers.MAXTHON);
    browsers.browserDbLocations.vivaldi = browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI);
    browsers.browserDbLocations.edge = browsers.findPaths(browsers.defaultPaths.edge, browsers.EDGE);
    browsers.browserDbLocations.avast = browsers.findPaths(browsers.defaultPaths.avast, browsers.AVAST);

    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.firefox, browsers.FIREFOX, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.chrome, browsers.CHROME, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.opera, browsers.OPERA, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.torch, browsers.TORCH, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.brave, browsers.BRAVE, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.vivaldi, browsers.VIVALDI, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.maxthon, browsers.MAXTHON, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.edge, browsers.EDGE, historyTimeLength));
    allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.avast, browsers.EDGE, historyTimeLength));
    //No Path because this is handled by the dll

    return allBrowserRecords;
}

module.exports = {
    // History functions
    getAllHistory,
    getFirefoxHistory,
    getSeaMonkeyHistory,
    getChromeHistory,
    getOperaHistory,
    getTorchHistory,
    getBraveHistory,
    getMaxthonHistory,
    getVivaldiHistory,
    getMicrosoftEdge,
    getAvastHistory,

    // Bookmark functions
    getAllBookmarks,
    getFirefoxBookmarks,
    getSeaMonkeyBookmarks,
    getChromeBookmarks,
    getOperaBookmarks,
    getBraveBookmarks,
    getVivaldiBookmarks,
    getMicrosoftEdgeBookmarks,
    getAvastBookmarks
};