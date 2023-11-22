/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */
// @ts-check
import fetch from "node-fetch";
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load } from 'cheerio';
import puppeteer from 'puppeteer';
import { parse } from 'date-fns';
import _ from 'lodash'
import hsum from 'hash-sum'

const OPTIONS = {
    useCache: true
}

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const dirs = {
    CACHE: join(DIRNAME, './cache'),
    RESULT: join(DIRNAME, './data'),
    RESULT_SPECS: join(DIRNAME, './data/techpowerup_gpus_specifications.json'),
};

if (!existsSync(dirs.CACHE)) await fs.mkdir(dirs.CACHE);
if (!existsSync(dirs.RESULT)) await fs.mkdir(dirs.RESULT);

const CACHE = {
    url2filename: (url) => `${[hsum(url), url.toString().replace(/[<>:"/\\|?*]/g, '_')].join('_')}.html`,
    getFilepathByUrl: (url) => join(dirs.CACHE, CACHE.url2filename(url)),
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
        const fileName = CACHE.url2filename(url);
        const filePath = join(dirs.CACHE, fileName);

        if (OPTIONS.useCache && existsSync(filePath)) {
            console.log('[getCacheOrNull] retrieving cached pages');
            const t = (await fs.readFile(filePath)).toString();
            console.log('[getCacheOrNull] done');
            return t;
        }

        console.log('[getCacheOrNull] no cache found, returning');
        return null;
    }
}


const fetchAndSave = async (url) => {
    console.log(`[fetchAndSave] fetching ${url}`);
    const html = CACHE.getCacheOrNull(url);
    if (html) return html;

    console.log('[fetchAndSave] loading page');
    const d = await fetch('https://pcbuilder.net/product/graphics-card/');
    const text = await d.text();
    CACHE.saveHtmlInCache(url, text);
    console.log('[fetchAndSave] done');
    return text;
}

const DetailsNamesAssoc = {
    "Brand:": "brand",
    "Model:": "model",
    "Memory:": "memory",
    "Memory Interface:": "memory_interface",
    "Length:": "length",
    "Interface:": "interface",
    "Chipset:": "chipset",
    "Base Clock:": "base_clock",
    "Clock Speed:": "clock_speed",
    "Frame Sync:": "frame_sync",
}

const html2json = (html) => {
    const $ = load(html);
    const gpus = $('#myTable .items');
    return gpus.map(function gpusMapper() {
        const details = $(this).find('.detail').map(function detailMapper() {
            const name = $(this).find('.detail__name').text().trim()
            const value = $(this).find('.detail__value').text().trim()
            return { name, value }
        }).get().reduce((acc, { name, value }) => ({ ...acc, [DetailsNamesAssoc[name]]: value }), {});
        const name = $(this).find('.table_title').text();
        const itemUrl = $(this).find('.table_title a').attr()?.href;
        const price = +$(this).find('.price').text().replace(/[^\d.]/g, '');

        return { name, ...details, price, item_url: itemUrl }
    }).get();
}

const URLS = {
    TECHPOWERUP_GPUS_SPECS: 'https://www.techpowerup.com/gpu-specs/',
};


const randomTimeout = (from, to) => new Promise(res => {
    const ms = _.random(from, to, false);
    console.log(`[randomTimeout] holding breath for ${ms}ms`);
    setTimeout(res, ms)
})

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
            await page.setViewport({ width: 1080, height: 1024 });
        }
        return page
    },
    /**
     * @param {*} url - string
     * @return {Promise<[boolean, string]>} - [isFromCache, theHtml] 
     */
    getHtml: async (url) => {
        console.log(`[getHtml]: start getting ${url}`)
        const html = await CACHE.getCacheOrNull(url);
        if (html) return [true, html];
        console.log('[getHtml]: scrapping')
        const p = await scrappers.getPage();
        await p.goto(url);
        await p.waitForNetworkIdle();
        const theHtml = await p.content();
        CACHE.saveHtmlInCache(url, theHtml);
        console.log('[getHtml]: done')
        return [false, theHtml];
    },

    /**
     * @param {string} value
     * @return {Promise<[boolean, string]>} - [isFromCache, theHtml] 
     */
    getGpusByGeneration: async (value) => {
        console.log(`[getGpusByGeneration]: start generation ${value}`);
        const url = new URL(`${URLS.TECHPOWERUP_GPUS_SPECS}?mobile=No&igp=No&sort=name`);
        url.searchParams.append('generation', value);
        url.toString();

        const html = await CACHE.getCacheOrNull(url.toString());
        if (html) return [true, html];

        console.log('[getGpusByGeneration]: scrapping')
        const p = await scrappers.getPage();
        const isSameUrl = p.url().startsWith(URLS.TECHPOWERUP_GPUS_SPECS);

        if (!isSameUrl) {
            await p.goto(url.toString());
        }
        // ?? пользак пару сек аутирует, чтобы найти фильтры
        await randomTimeout(1000, 3000);
        await page.waitForSelector('#generation');
        // ?? Пользак выбирает фильтр по поколениям, очищает значения
        await page.select('#generation', '');
        await p.waitForNetworkIdle();
        // ?? Пользак аутирует пару сек, чтоб выбрать нужное поколение
        await randomTimeout(1000, 3000);
        await page.waitForSelector('#generation');
        // ?? Пользак выбирает нужно поколение
        await page.select('#generation', value);
        await p.waitForNetworkIdle();
        // ?? Пользак анализирует данные
        await randomTimeout(3000, 5000);
        const theHtml = await p.content();
        CACHE.saveHtmlInCache(url.toString(), theHtml);
        console.log('[getGpusByGeneration]: done')
        return [false, theHtml];
    }
}

const parsers = {
    getText: (v) => load(v).text().trim(),

    /**
     * @param {string} html - https://www.techpowerup.com/gpu-specs/ html
     * @return {{'value': string, 'count': number}[]};
     */
    getTpuOptionsListById: (html) => {
        const $ = load(html);
        // Надо выбрать тот набор фильтров, который позволит выгружать по 100 штук за раз, это ограничение TPU
        return $(`#generation option`).toArray().map((element) => ({
            value: element.attribs.value ?? null,
            count: element.attribs.value ? Number($(element).text()?.match(/\((\d+)\)/g)?.map(m => m?.match(/\d+/)?.[0])) : 0,
        })).filter(v => v.value);
    },

    /**
     * @param {string} html - https://www.techpowerup.com/gpu-specs/ html
     */
    getTpuProcessors: (html) => {
        const $ = load(html);
        const $table = $('.processors');
        const headings = $table.find('thead').toArray().filter((v, i) => i % 2 === 0);

        const tbodies = $table.find('tbody').toArray().map((tbody, i) => {
            const rows = $(tbody).find('tr');
            return rows.toArray().map(v => {
                const values = $(v).find('td');
                const [memory_size, memory_type, memory_bus] = parsers.getText(values.get(4)).split(',').map(s => s.trim());
                return {
                    manufacturer: parsers.getText(headings[i]),
                    product_name: parsers.getText(values.get(0)),
                    url: `https://www.techpowerup.com${$(values.get(0)).find('a').attr('href')}`,
                    chip: parsers.getText(values.get(1)),
                    release_date: parse(parsers.getText(values.get(2)), "MMM do, yyyy", new Date()),
                    bus_interface: parsers.getText(values.get(3)),
                    memory_size,
                    memory_type,
                    memory_bus,
                    gpu_clock: parsers.getText(values.get(5)),
                    memory_clock: parsers.getText(values.get(6)),
                }
            })
        })

        return _.flatten(tbodies);
    }
};

const fetchAndSaveGpuSpecifications = async () => {
    const [, tpuSpecsGenericPageHtml] = await scrappers.getHtml(`${URLS.TECHPOWERUP_GPUS_SPECS}?mobile=No&igp=No&sort=name`);

    const gpuGenerationsList = parsers.getTpuOptionsListById(tpuSpecsGenericPageHtml);

    let gpus = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, generation] of gpuGenerationsList.entries()) {
        
        console.log(`[fetchAndSaveGpuSpecifications]: done ${index + 1} / ${gpuGenerationsList.length}`);
        console.log(`[fetchAndSaveGpuSpecifications]: starting to process generation ${generation.value}`);
        console.log(`[fetchAndSaveGpuSpecifications]: expect to receive ${generation.count} rows`);
        const [, tpuSpecsPageWithGenerationFilterHtml] = await scrappers.getGpusByGeneration(generation.value);
        const rows = parsers.getTpuProcessors(tpuSpecsPageWithGenerationFilterHtml);
        if (rows.length !== generation.count) {
            // console.error(`[fetchAndSaveGpuSpecifications]: expected to receive ${generation.count} rows, received ${rows.length}`);
            throw new Error(`[fetchAndSaveGpuSpecifications]: expected to receive ${generation.count} rows, received ${rows.length}`);
            // await new Promise(res => {setTimeout(res, 600000)
            // });
        } else {
            console.log(`[fetchAndSaveGpuSpecifications]: received ${rows.length} rows, ok to proceed`);
        }
        gpus = gpus.concat(rows);
    }

    await fs.writeFile(dirs.RESULT_SPECS, JSON.stringify(gpus, null, 2))
    console.log(`[script] GPUs specifications has been parsed successfully. Count: ${gpus.length}.`);
}

(async () => {
    // https://www.techpowerup.com/gpu-specs/?mobile=No&igp=No&sort=name

    await fetchAndSaveGpuSpecifications();

    // const url = 'https://pcbuilder.net/product/graphics-card/';
    // const text = await fetchAndSave(url);
    // const json = html2json(text);
    // await fs.writeFile(join(dirs.RESULT, './pcbuilder_gpus_current.json'), JSON.stringify(json, null, 2));

    // @ts-ignore
    if (browser) await browser.close()
    console.log('[script] the END');
})()

