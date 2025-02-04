//function to scrape webpage

import axios from 'axios';
import * as cheerio from 'cheerio';
import OpenAI from 'openai'
import dotenv from 'dotenv';
import {ChromaClient} from 'chromadb';

dotenv.config({
    path: '.env',
});

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const chromaClient = new ChromaClient({
    path: 'http://localhost:8000'
});
chromaClient.heartbeat();// for connnection test.

const WEB_COLLECTION = `WEB_SCRAPED_DATA_COLLECTION-1`;


async function scrapeWebpage(url) {
    try {
        const {data} = await axios.get(url);
        const $ = cheerio.load(data); //scrape the page and load in $
    
        
        const pageHead = $('head').html();
        const pageBody = $('body').html();
        
        const internalLinks = new Set();
        const extenalLinks = new Set();
    
        $('a').each((_, el) => {
            const link = $(el).attr('href') //gives all the links in the webpage
    
            if(link === "/") return;
    
            if(link.startsWith("http") || link.startsWith("https")){
                extenalLinks.add(link);
            } else {
                internalLinks.add(link);
            }
        });
    
        return { head: pageHead, body: pageBody, internalLinks: Array.from(internalLinks), extenalLinks: Array.from(extenalLinks)}
    } catch (err) {
        console.log(`Error in ${url}`)// if there is break url
    }
}

//funtion to generate the vector embeddings - using openai
async function generateVectorEmbeddings({text}) {
    const embeddings = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: "float",
    });
    return embeddings.data[0].embedding;
}


//function to convert the text into small chunks
function chunkText(text, chunkSize){
    if(!text || chunkSize <= 0) return [];

    const words = text.split(/\s+/);
    const chunks = [];

    for(let i = 0; i < words.length; i += chunkSize){
        chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    return chunks;
}

async function insertIntoDB({embedding, url, body = '', head}) {
    const collection = await chromaClient.getOrCreateCollection({
        name: WEB_COLLECTION,
    });

    await collection.add({
        ids: [url],
        embeddings: [embedding],
        metadatas: [{url, body, head}]
    });


}

// this funtion call recursily to scrape and create vector embeddings and store it in chroma DB.
async function ingest(url = "") {
    //scraping the webpage
    const {head, body, internalLinks} = await scrapeWebpage(url);

    // const headEmbedding = await generateVectorEmbeddings({text: head});
    // await insertIntoDB({embedding: headEmbedding, url})
    const bodyChunks = chunkText(body, 1000);

    for (const chunk of bodyChunks) {
        const bodyEmbedding = await generateVectorEmbeddings({text: chunk});
        await insertIntoDB({embedding: bodyEmbedding, url, head, body : chunk});   
    }

    for (const link of internalLinks) {
        const _url = `${url}${link}`
        await ingest(_url); //recursive call;
    }
}

//chat with the vector
async function chat(question = '') {
    const questionEmbedding = await generateVectorEmbeddings({text: question})

    const collection = await chromaClient.getOrCreateCollection({
        name: WEB_COLLECTION,
    });

    const collectionResult = await collection.query({
        nResults: 1,// pick from the relevent source.
        queryEmbeddings: questionEmbedding,
    });

    const body = collectionResult.metadatas[0].map(e => e.body).filter(e => e.trim() !== "" && !!e);
    const url = collectionResult.metadatas[0].map(e => e.url).filter(e => e.trim() !== "" && !!e);

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {role: 'system', content: "you are an AI support agent expert in providing support to users on behalf of a webpage. Given the context about page content, reply the user accordingly."},
            {
                role: "user",
                content: `
                    Query: ${question}\n\n
                    URL: ${url.join(", ")}
                    Retrived context: ${body.join(", ")}
                `
            }
        ],
    });

    console.log(`🤖: ${response.choices[0].message.content}`)
}