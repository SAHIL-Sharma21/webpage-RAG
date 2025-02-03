//function to scrape webpage

import axios from 'axios';
import * as cheerio from 'cheerio';

async function scrapeWebpage(url) {
    const {data} = await axios.get(url);
    const $ = cheerio.load(data); //scrape the page and load in $

    
    const pageHead = $('head').html();
    const pageBody = $('body').html();
    
    const internalLinks = [];
    const extenalLinks = [];

    $('a').each((_, el) => {
        const link = $(el).attr('href') //gives all the links in the webpage

        if(link === "/") return;

        if(link.startsWith("http") || link.startsWith("https")){
            extenalLinks.push(link)
        } else {
            internalLinks.push(link);
        }
    });

    return { head: pageHead, body: pageBody, internalLinks, extenalLinks}
}