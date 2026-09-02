/**
 * OpenFloat POS X — Product Image Downloader & Local Storage Manager
 *
 * Downloads product images from Google Drive or remote web URLs during
 * CSV bulk import or single product registration, saves them into
 * `./uploads/products/`, and returns the local relative URL.
 */

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/products');

// Ensure destination directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Normalizes Google Drive or other special URLs into direct CDN download URLs.
 */
function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Convert Google Drive preview/sharing links to direct CDN stream URLs
  const driveMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }

  return trimmed;
}

/**
 * Map common MIME types to file extensions (SVG disallowed to prevent stored XSS).
 */
function getExtensionFromMime(mime) {
  if (!mime) return '.jpg';
  const cleanMime = mime.toLowerCase().split(';')[0].trim();
  switch (cleanMime) {
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    case 'image/gif':  return '.gif';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    default:
      return cleanMime === 'image/svg+xml' ? null : '.jpg';
  }
}

/**
 * SSRF Guard: Validate that target remote image URL does not target localhost, private IPs, or cloud metadata.
 */
function isSafeRemoteUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const p1 = parseInt(ipMatch[1]);
      const p2 = parseInt(ipMatch[2]);
      if (p1 === 10) return false;
      if (p1 === 127) return false;
      if (p1 === 169 && p2 === 254) return false;
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
      if (p1 === 192 && p2 === 168) return false;
      if (p1 === 0) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Utility: Sleep for specified milliseconds (for exponential backoff).
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cleans up any existing image files for the given SKU (including old timestamps and different extensions)
 */
function removeExistingSkuImages(cleanSku) {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      // Matches "SKU.jpg", "SKU.png", and legacy "SKU_timestamp_random.jpg"
      if (f === cleanSku || f.startsWith(cleanSku + '.') || f.startsWith(cleanSku + '_')) {
        try {
          fs.unlinkSync(path.join(UPLOADS_DIR, f));
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[ImageDownloader] Cleanup error:', err.message);
  }
}

/**
 * Fetches an image server-side, saves it locally in `./uploads/products/`,
 * and returns the local URL (e.g. `/uploads/products/SKU-1001.jpg`).
 *
 * Includes retry handling with exponential backoff for 429 rate limits or network drops.
 *
 * @param {string} rawUrl - Incoming image URL (Google Drive, HTTPS, base64 data URL, or local path)
 * @param {string} [sku='prod'] - Product SKU for naming
 * @param {number} [maxRetries=3] - Maximum retry attempts
 * @returns {Promise<string|null>} - Local URL path or null on failure
 */
async function downloadAndSaveImage(rawUrl, sku = 'prod', maxRetries = 3) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // 1. If already a local uploaded path, keep as-is
  if (trimmed.startsWith('/uploads/products/') || trimmed.startsWith('uploads/products/')) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  const cleanSku = String(sku || 'prod')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';

  // 2. Handle base64 Data URLs directly (e.g. from frontend file uploads)
  if (trimmed.startsWith('data:image/')) {
    try {
      const parts = trimmed.split(',');
      if (parts.length === 2) {
        const mimeMatch = parts[0].match(/data:(image\/[a-zA-Z0-9+-]+);base64/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext = getExtensionFromMime(mime);
        if (!ext) {
          console.warn(`[ImageDownloader] Disallowed image type for SKU ${sku}`);
          return null;
        }

        const buffer = Buffer.from(parts[1], 'base64');
        if (buffer.length > 10 * 1024 * 1024) {
          console.warn(`[ImageDownloader] Base64 image exceeds 10MB limit for SKU ${sku}`);
          return null;
        }

        removeExistingSkuImages(cleanSku);
        const filename = `${cleanSku}${ext}`;
        const filePath = path.join(UPLOADS_DIR, filename);

        fs.writeFileSync(filePath, buffer);
        return `/uploads/products/${filename}`;
      }
    } catch (err) {
      console.warn(`[ImageDownloader] Failed to save base64 image for SKU ${sku}:`, err.message);
      return null;
    }
  }

  // 3. Normalize remote URL (Google Drive -> direct CDN)
  const targetUrl = normalizeImageUrl(trimmed);
  if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
    return null;
  }

  // SSRF Protection: ensure remote destination is not private/local
  if (!isSafeRemoteUrl(targetUrl)) {
    console.warn(`[ImageDownloader] Blocked potentially unsafe or internal URL for SKU ${sku}: ${targetUrl}`);
    return null;
  }

  // 4. Download remote image with exponential backoff retries
  let attempt = 0;
  let delay = 1000; // start with 1 second

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(12000) // 12-second timeout per attempt
      });

      // Handle HTTP 429 Rate Limit or 503 Server Busy
      if (response.status === 429 || response.status === 503) {
        console.warn(`[ImageDownloader] Attempt ${attempt}/${maxRetries}: HTTP ${response.status} from server for SKU ${sku}. Retrying in ${delay}ms...`);
        if (attempt < maxRetries) {
          await sleep(delay);
          delay *= 2; // exponential backoff
          continue;
        }
      }

      if (!response.ok) {
        console.warn(`[ImageDownloader] HTTP error ${response.status} (${response.statusText}) when downloading ${targetUrl} for SKU ${sku}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = getExtensionFromMime(contentType);
      if (!ext) {
        console.warn(`[ImageDownloader] Disallowed or dangerous MIME type (${contentType}) for SKU ${sku}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Verify we actually received image bytes and within 10MB limit
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
        console.warn(`[ImageDownloader] Invalid image size (${buffer.length} bytes) for SKU ${sku}`);
        return null;
      }

      removeExistingSkuImages(cleanSku);
      const filename = `${cleanSku}${ext}`;
      const filePath = path.join(UPLOADS_DIR, filename);

      fs.writeFileSync(filePath, buffer);
      return `/uploads/products/${filename}`;
    } catch (err) {
      console.warn(`[ImageDownloader] Attempt ${attempt}/${maxRetries} error for SKU ${sku}: ${err.message}`);
      if (attempt < maxRetries) {
        await sleep(delay);
        delay *= 2;
      } else {
        console.warn(`[ImageDownloader] All ${maxRetries} download attempts failed for SKU "${sku}". Image will default to placeholder.`);
        return null;
      }
    }
  }

  return null;
}

module.exports = {
  downloadAndSaveImage,
  normalizeImageUrl,
  UPLOADS_DIR
};

