import { describe, it, expect } from 'vitest';
import emailTextTemplate from '../../src/template/email-text';

describe('emailTextTemplate', () => {
  it('escapes HTML tags in plain text to prevent XSS', () => {
    const maliciousText = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const result = emailTextTemplate(maliciousText);

    expect(result).not.toContain('<script>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('safely handles empty or null text', () => {
    const resultEmpty = emailTextTemplate('');
    expect(resultEmpty).toContain('<span></span>');

    const resultNull = emailTextTemplate(null);
    expect(resultNull).toContain('<span></span>');
  });

  it('renders normal text preserving content', () => {
    const normalText = 'Hello, this is a plain text email.\nLine 2';
    const result = emailTextTemplate(normalText);

    expect(result).toContain('Hello, this is a plain text email.\nLine 2');
  });
});
