const cheerio = require("cheerio"); // Used to parse static HTML
const got = require("got"); // Used to make network requests to get HTML
const puppeteer = require("puppeteer"); // Used to parse dynamic HTML
require("dotenv").config(); // Used to manage environment variables
const fs = require("fs"); // Used to download videos
const stream = require("stream"); // Used to download videos
const { promisify } = require("util"); // Used to downlaod videos
const pipeline = promisify(stream.pipeline);

function getVideoURL(link) {
  let index = link.indexOf("?");
  let url = link.slice(0, index);

  return url;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getVideoFileURLCheerio(link) {
  let videoLink;
  try {
    const response = await got(link);
    const $ = cheerio.load(response.body);
    videoLink = $("source[res='720']").prop("src").slice(2);
  } catch (e) {
    console.log(`Link: ${link} produced error: ${e}`);
  } finally {
    return videoLink ? `https://${videoLink}` : videoLink;
  }
}

async function getVideoLinksFromProfile(profileURL) {
  let start = process.hrtime();
  let numVideos;
  const browser = await puppeteer.launch({ headless: true, timeout: 0 });
  const page = await browser.newPage();

  await page.goto(profileURL, {
    waitUntil: "networkidle2",
    timeout: 0,
  });

  numVideos = (await page.$$(".video-list-container>.video-list>li.video-item"))
    .length;

  // Class of footer is mod-page-foot, class of month divs is video-list-container
  // Initially count the number of divs with class video-list-container on page load, using page.$$
  // Scroll to footer div using page.hover, wait a few seconds, then count number of divs with that class, repeat
  // When the number stops increasing, all videos were loaded on the page

  while (true) {
    await page.hover(".mod-page-foot");
    await page.waitForResponse(
      (res) =>
        res.status() === 200 && res.url().includes("https://plays.tv/ws/module")
    );
    await delay(2000); // Timer is needed between requests because of rate limiting

    let curr = (
      await page.$$(".video-list-container>.video-list>li.video-item")
    ).length;

    if (numVideos < curr) numVideos = curr;
    else break;
  }

  // ALl videos are loaded on the  page at this point
  // With the array of video-item elementHandle, get the links for each video page
  let videoItems = await page.$$(
    ".video-list-container>.video-list>li.video-item>.wrapper>a.thumb-link"
  );

  let videoLinks = await Promise.all(
    videoItems.map(async function (el) {
      let propHandle = await el.getProperty("href");
      let propValue = await propHandle.jsonValue();
      return propValue;
    })
  );

  await page.close();
  await browser.close();
  let hrend = process.hrtime(start);
  console.log(
    "Puppeteer Execution time: %ds %dms",
    hrend[0],
    hrend[1] / 1000000
  );
  console.log(`Videos: ${videoLinks.map(getVideoURL).length}`);

  return videoLinks.map(getVideoURL);
}

async function videoDownloader(fileURL, fileName) {
  await pipeline(
    got.stream(fileURL),
    fs.createWriteStream(`videos/${fileName}.mp4`)
  );
}

async function run() {
  console.log(' Creating VIdeos Directory ');
  fs.mkdir(`${process.cwd()}/videos`, (err) => {
    if (err.code !== 'EEXIST') throw err;
  });

  console.log('Scraping profile for videos')
  let allLinks = await getVideoLinksFromProfile(process.env.PROFILE_URL);
  console.log(`${allLinks.length} videos were found on the profile`)

  let allFileLinks = (
    await Promise.all(allLinks.map(getVideoFileURLCheerio))
  ).filter((link) => link !== undefined);

  console.log(`${allFileLinks.length} of ${allLinks.length} videos were found archived`);

  console.log('Downloading Videos');

  // await downloader(allFileLinks[0], "tset");
}

run();
