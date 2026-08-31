browser.contextMenus.create({
    id: "yt-dlp-download",
    title: "Download video with yt-dlp",
    contexts: ["link", "video"],
    icons: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png"
    }
});

browser.contextMenus.onClicked.addListener((info, tab) => {
    const url = info.linkUrl || info.srcUrl;

    fetch("http://localhost:16800/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
    })
    .then(res => res.text())
    .then(msg => console.log("yt-dlp response:", msg))
    .catch(err => console.error("yt-dlp error:", err));
});
