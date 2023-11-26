/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */
// @ts-check
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname, relative, basename } from 'path'
import { fileURLToPath } from 'url'
import { load } from 'cheerio';
import puppeteer, { TimeoutError } from 'puppeteer';
import _ from 'lodash';
import hsum from 'hash-sum';
import sharp from 'sharp';

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const dirs = {
    CACHE: join(DIRNAME, './cache'),
    DATA: join(DIRNAME, './data'),
    DATA_SCREENSHOTS_FOLDER: join(DIRNAME, './data/screenshots/'),
    DATA_WEBSITES: join(DIRNAME, './data/websites.json'),
    RESULT: join(DIRNAME, './data/result/'),
    RESULT_WEBSITES: join(DIRNAME, './data/result/websites.json'),
    RESULT_SCREENSHOTS: join(DIRNAME, './data/result/screenshots'),
};

if (!existsSync(dirs.CACHE)) await fs.mkdir(dirs.CACHE);
if (!existsSync(dirs.DATA)) await fs.mkdir(dirs.DATA);
if (!existsSync(dirs.DATA_SCREENSHOTS_FOLDER)) await fs.mkdir(dirs.DATA_SCREENSHOTS_FOLDER);
if (!existsSync(dirs.RESULT)) await fs.mkdir(dirs.RESULT);
if (!existsSync(dirs.RESULT_SCREENSHOTS)) await fs.mkdir(dirs.RESULT_SCREENSHOTS);


const RESOURSES = {
    SIMILARWEB_TOP_WEBSITES: join(DIRNAME, './resources/similarweb-top-websites/'),
}

const CACHE = {
    url2filename: (url) => `${[hsum(url), url.toString().replace(/[<>:"/\\|?*]/g, '_')].join('_')}.png`,
    getFilepathByUrl: (url) => join(dirs.DATA_SCREENSHOTS_FOLDER, CACHE.url2filename(url)),
    saveHtmlInCache: async (url, html) => {
        try {
            const path = CACHE.getFilepathByUrl(url);
            console.log(`[saveHtmlInCache] saving page to ${path}`);
            return await fs.writeFile(path, html);
        } catch (e) {
            console.error('[saveHtmlInCache] can\'t save chief')
            console.error(e);
            return null;
        }
    },
    getCacheOrNull: async (url) => {
        console.log(`[getCacheOrNull] start ${url}`);
        const filePath = CACHE.getFilepathByUrl(url);

        console.log(`[getCacheOrNull] trying to check ${filePath} existence.`);
        if (existsSync(filePath)) {
            console.log('[getCacheOrNull] screenshot exists');
            return relative(DIRNAME, filePath);
        }

        console.log('[getCacheOrNull] no cache found, continue');
        return null;
    }
}

/** @type {import('puppeteer').Browser} */
let browser;
/** @type {import('puppeteer').Page} */
let page;

const scrappers = {
    /**
     * @return {Promise<import('puppeteer').Page>} 
     */
    getPage: async () => {
        if (!browser) {
            browser = await puppeteer.launch({ headless: false });
        }
        if (!page) {
            page = await browser.newPage();
            await page.setViewport({ width: 1600, height: 900 });
            await page.setBypassCSP(true);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0')
        }
        return page
    },
    /**
     * @param {*} url - string
     * @return {Promise<string>} - path to screenshot
     */
    saveScreenshotOrGetPath: async (url) => {
        console.log(`[getHtml]: start getting ${url}`);
        const existingPathToScreenshot = await CACHE.getCacheOrNull(url);
        if (existingPathToScreenshot) return existingPathToScreenshot;
        console.log('[getHtml]: scrapping');
        const p = await scrappers.getPage();
        await p.goto('about:blank');

        try {
            await p.goto(url, { waitUntil: 'load', timeout: 30000 });
        } catch (e) {
            const m = await p.metrics();
            if (Number(m.Nodes) > 100) {
                console.error(e);
                console.log('[getHtml]: taking screenshot nonetheless');
            } else {
                throw e;
            }
        }

        const pathToScreenshot = CACHE.getFilepathByUrl(url);
        console.log(`[getHtml]: taking screenshot and saving to ${pathToScreenshot}`);
        await p.screenshot({ fullPage: true, path: pathToScreenshot });
        return pathToScreenshot;
    },
}

const parsers = {
    getText: (v) => load(v).text().trim(),

    /**
     * @param {*} html - string
     * @return {{ position: number, name: string, url: string }[]}
     */
    getSimilarWebTopWebsites: (html) => {
        const $ = load(html);
        const $rows = $('.top-table__content > tbody > tr');
        return $rows.toArray().map((element) => {
            const $element = $(element);
            const tds = $element.find('td');
            const position = Number(parsers.getText(tds.get(0)));
            const name = parsers.getText(tds.get(1));
            const url = new URL(`https://${name}`).toString();
            return { position, name, url }
        });
    }
};

/**
 * @return {Promise<{ position: number, name: string, url: string, category: string }[]>}
 */
const readFilesInDirAndExecuteFn = async (dir, fn) => {
    console.log(`[readFilesInDirAndExecuteFn] Starting to read ${dir}`);
    const d = await fs.readdir(dir);
    let result = [];
    for (const fileName of d) {
        const content = await fs.readFile(join(dir, fileName));
        const parsed = fn(content.toString());
        result = result.concat(parsed.map(v => ({ ...v, category: fileName.split('.')[0] })));
    }
    return result;
}

const readTopWebsites = async () => {
    console.log(`[script] Starting to load top websites.`);
    const d = await readFilesInDirAndExecuteFn(RESOURSES.SIMILARWEB_TOP_WEBSITES, parsers.getSimilarWebTopWebsites);
    return d;
}

(async () => {
    // https://www.similarweb.com/ru/top-websites/
    // const websites = await readTopWebsites();

    // Taking screenshots
    // for (const [index, website] of websites.entries()) {
    //     try {
    //         // @ts-expect-error
    //         website.screenshot = await scrappers.saveScreenshotOrGetPath(website.url);
    //     } catch (e) {
    //         console.log(`[script] my gosh, can't take a pic of ${website.name}`);
    //         console.error(e);
    //     }
    //     console.log(`[script] progress ${index + 1}/${websites.length} (${((index + 1) / websites.length) * 100}%)`);
    // }
    // await fs.writeFile(dirs.RESULT_WEBSITES, JSON.stringify(websites, null, 2))


    /** @type {{ position: number, name: string, url: string, category: string}[]} */
    const websites = JSON.parse((await fs.readFile(dirs.DATA_WEBSITES)).toString());

    /** @type {{ position: number, name: string, url: string, category: string; path: string}[]} */
    const updated = [];
    for (const [, website] of websites.entries()) {
        const pathToScreenshot = CACHE.getFilepathByUrl(website.url);
        console.log(`[script] checking ${pathToScreenshot}`);
        
        const exists = existsSync(pathToScreenshot);
        if (exists) {
            console.log(`[script] processing ${website.name}`);
            const screenshotBasename = basename(pathToScreenshot);
            const pathToUpdatedScreenshot = join(dirs.RESULT_SCREENSHOTS, screenshotBasename);
            // await sharp(pathToScreenshot).resize(null, 3000, {
            //     fit: sharp.fit.cover
            // }).toFile(pathToUpdatedScreenshot);

            updated.push({ ...website, path: relative(dirs.RESULT, pathToUpdatedScreenshot) });
        };
    }

    await fs.writeFile(dirs.RESULT_WEBSITES, JSON.stringify(updated, null, 2))

    // @ts-ignore
    if (browser) await browser.close()
    console.log('[script] the END');
})()

