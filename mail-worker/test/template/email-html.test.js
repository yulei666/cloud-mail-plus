import { describe, it, expect } from 'vitest';
import emailHtmlTemplate from '../../src/template/email-html';

describe('emailHtmlTemplate', () => {
  it('safely embeds HTML containing backticks and ${...} without template injection', () => {
    const maliciousHtml = '<p>Use `rm -rf /` and ${process.env.SECRET} here</p>';
    const result = emailHtmlTemplate(maliciousHtml, 'example.com');

    // The output should contain safe JSON string without raw unescaped template backticks breaking the script
    expect(result).toContain('const exampleHtml = "');
    expect(result).toContain('Use `rm -rf /` and ${process.env.SECRET}');
  });

  it('safely escapes closing </script> tags in content using \\u003C', () => {
    const scriptBreakoutHtml = '<p>hello</p></script><script>alert(1)</script>';
    const result = emailHtmlTemplate(scriptBreakoutHtml, 'example.com');

    // Should not contain literal </script> inside the string assignment
    expect(result).not.toContain('const exampleHtml = "</script>');
    expect(result).toContain('\\u003C');
  });

  it('strips <script> tags from the source HTML', () => {
    const htmlWithScript = '<div>Content</div><script>console.log("bad")</script>';
    const result = emailHtmlTemplate(htmlWithScript, 'example.com');

    expect(result).not.toContain('console.log("bad")');
    expect(result).toContain('Content');
  });

  it('replaces {{domain}} with oss domain', () => {
    const htmlWithDomain = '<img src="{{domain}}test.png">';
    const result = emailHtmlTemplate(htmlWithDomain, 'example.com');

    expect(result).not.toContain('{{domain}}');
  });

  it('includes nonce in <script> tag when provided', () => {
    const result = emailHtmlTemplate('<div>test</div>', 'example.com', 'test-nonce-12345');
    expect(result).toContain('<script nonce="test-nonce-12345">');
  });

  it('prevents CSS breakout by not interpolating bodyStyle into <style> block', () => {
    const breakoutHtml = '<body style="</style><img src=x onerror=alert(1)>">Hello</body>';
    const result = emailHtmlTemplate(breakoutHtml, 'example.com');
    const styleContent = result.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || '';
    expect(styleContent).not.toContain('onerror');
    expect(styleContent).not.toContain('</style>');
    expect(result).toContain('shadowContent.style.cssText = bodyStyle');
  });

  it('strips dangerous tags like iframe, object, embed, form, base, meta', () => {
    const dangerousHtml = '<div>Safe</div><iframe src="javascript:alert(1)"></iframe><form action="/steal"></form><base href="http://evil.com"><meta http-equiv="refresh" content="0;url=http://evil.com">';
    const result = emailHtmlTemplate(dangerousHtml, 'example.com');
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('<form');
    expect(result).not.toContain('<base');
    expect(result).not.toContain('http-equiv');
    expect(result).not.toContain('evil.com');
    expect(result).toContain('Safe');
  });
});
