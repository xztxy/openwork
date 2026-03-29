const MAX_SCREENSHOT_ATTACHMENT_COUNT = 1;
const MAX_SCREENSHOT_ATTACHMENT_LENGTH = 200_000;

/**
 * Attachment extracted from tool output.
 */
export interface MessageAttachment {
  type: 'screenshot' | 'json';
  data: string;
  label?: string;
}

/**
 * Extracts base64 screenshots from tool output text.
 * Returns the cleaned text with screenshots replaced by placeholders,
 * and an array of extracted screenshot attachments.
 */
export function extractScreenshots(output: string): {
  cleanedText: string;
  attachments: MessageAttachment[];
} {
  const attachments: MessageAttachment[] = [];

  const dataUrlRegex = /data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  let match;
  while ((match = dataUrlRegex.exec(output)) !== null) {
    const screenshotData = match[0];
    if (
      attachments.length < MAX_SCREENSHOT_ATTACHMENT_COUNT &&
      screenshotData.length <= MAX_SCREENSHOT_ATTACHMENT_LENGTH
    ) {
      attachments.push({
        type: 'screenshot',
        data: screenshotData,
        label: 'Browser screenshot',
      });
    }
  }

  const rawBase64Regex =
    /(?<![;,])(^|["\s])?((?:iVBORw0|\/9j\/|UklGR|R0lGOD)[A-Za-z0-9+/=]{100,})(["\s]|$)/g;
  while ((match = rawBase64Regex.exec(output)) !== null) {
    const base64Data = match[2];
    if (base64Data && base64Data.length > 100) {
      let mimeType = 'image/png';
      if (base64Data.startsWith('/9j/')) {
        mimeType = 'image/jpeg';
      } else if (base64Data.startsWith('UklGR')) {
        mimeType = 'image/webp';
      } else if (base64Data.startsWith('R0lGOD')) {
        mimeType = 'image/gif';
      }

      const screenshotData = `data:${mimeType};base64,${base64Data}`;
      if (
        attachments.length < MAX_SCREENSHOT_ATTACHMENT_COUNT &&
        screenshotData.length <= MAX_SCREENSHOT_ATTACHMENT_LENGTH
      ) {
        attachments.push({
          type: 'screenshot',
          data: screenshotData,
          label: 'Browser screenshot',
        });
      }
    }
  }

  let cleanedText = output
    .replace(dataUrlRegex, '[Screenshot captured]')
    .replace(rawBase64Regex, (_fullMatch, prefix = '', _data = '', suffix = '') => {
      return `${prefix}[Screenshot captured]${suffix}`;
    });

  cleanedText = cleanedText
    .replace(/"\[Screenshot captured\]"/g, '"[Screenshot]"')
    .replace(/\[Screenshot captured\]\[Screenshot captured\]/g, '[Screenshot captured]');

  return { cleanedText, attachments };
}
