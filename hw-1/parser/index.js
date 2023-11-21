// @ts-check
import fetch from "node-fetch";
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load } from 'cheerio';

const OPTIONS = {
    useCache: true
}

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const dirs = {
    CACHE: join(DIRNAME, './cache'),
    RESULT: join(DIRNAME, './data'),
};

if (!existsSync(dirs.CACHE)) await fs.mkdir(dirs.CACHE);
if (!existsSync(dirs.RESULT)) await fs.mkdir(dirs.RESULT);

const fetchAndSave = async (url) => {
    const b64 = btoa(url);
    const fileName = [b64, url.replace(/[<>:"/\\|?*]/g, '_')].join('_');
    const filePath = join(dirs.CACHE, fileName);

    if (OPTIONS.useCache && existsSync(filePath)) {
        const t = (await fs.readFile(filePath)).toString();
        return t;
    }

    const d = await fetch('https://pcbuilder.net/product/graphics-card/');
    const text = await d.text();
    await fs.writeFile(filePath, text);
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

(async () => {
    const url = 'https://pcbuilder.net/product/graphics-card/';
    const text = await fetchAndSave(url);
    const json = html2json(text);
    await fs.writeFile(join(dirs.RESULT, './pcbuilder_gpus_current.json'), JSON.stringify(json, null, 2));
})()