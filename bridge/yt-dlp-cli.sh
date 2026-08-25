#!/bin/bash
url="$1"

if [[ -z "$url" ]]; then
  echo "Error: No URL provided" >&2
  exit 1
fi

# Notify user download started
notify-send "yt-dlp" "Starting download: $url" -i download

# Run yt-dlp (uses ~/.config/yt-dlp/config for cookies, format, and ~/Downloads output)
if /usr/bin/yt-dlp "$url"; then
  notify-send "yt-dlp" "Download finished!" -i emojione-check-box
else
  notify-send "yt-dlp" "Download failed!" -u critical
fi
