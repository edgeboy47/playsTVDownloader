const cheerio = require("cheerio"); // Used to parse static HTML
const got = require("got"); // Used to make network requests to get HTML
const puppeteer = require("puppeteer"); // Used to parse dynamic HTML
require("dotenv").config(); // Used to manage environment variables

const fs = require("fs"); // Used to download videos
const stream = require("stream"); // Used to download videos
const { promisify } = require("util"); // Used to download videos
const pipeline = promisify(stream.pipeline); //Used to download videos
const async = require("async");

let totalDownloads = 0;

// Converts link found in user profile to the video URL
function getVideoURL(link) {
  let index = link.indexOf("?");
  let url = link.slice(0, index);

  return url;
}

// Extracts the name of the video from the video URL
function getVideoNameFromURL(link) {
  let regex = /video\/(.+)\/(.+)$/;

  let hash = link.match(regex)[1];
  let name = link.match(regex)[2];

  return `${name} - ${hash}`;
}

// Promise based timer
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gets URL for the video file from the video URL, using Ch
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

// Gets all video URLs given the profile URL, and returns them in an array
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

  return videoLinks.map(getVideoURL);
}

// Downloads the video at fileUrl and saves it as the given fileName
async function videoDownloader({ name, url }) {
  try {
    await pipeline(
      got.stream(url),
      fs.createWriteStream(`videos/${name}.mp4`, { flags: "wx" })
    );
    totalDownloads++;
    console.log(`${name} downloaded, ${totalDownloads} total downloads`);
  } catch (err) {
    console.log(`Video ${name} gave error: ${err}`);
  }
}

async function run() {
  console.log("Creating Videos Directory");

  fs.mkdir(`${process.cwd()}/videos`, (err) => {
    if (err && err.code !== "EEXIST") throw err;
  });

  console.log("Scraping profile for videos");

  let allLinks = await getVideoLinksFromProfile(process.env.PROFILE_URL);

  console.log(`${allLinks.length} videos were found on the profile`);

  console.log("Searching for archived videos");

  let allFileLinks = (
    await Promise.all(
      allLinks.map(async function (link) {
        return {
          name: getVideoNameFromURL(link),
          url: await getVideoFileURLCheerio(link),
        };
      })
    )
  )
    .filter((link) => link.url !== undefined)
    .sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;

      return 0;
    });

  console.log(
    `${allFileLinks.length} of ${allLinks.length} videos were found archived`
  );

  console.log("Downloading Videos. This may take a while.");

  await async.eachSeries(allFileLinks, videoDownloader);

  console.log("Done.");
}

run();
