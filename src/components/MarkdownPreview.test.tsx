/* @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

function renderMarkdown(source: string) {
	// Disable Shiki highlighting to keep the tree synchronous for assertions.
	const { container } = render(<MarkdownPreview highlight={false}>{source}</MarkdownPreview>);
	return container;
}

describe("MarkdownPreview — raw HTML passthrough", () => {
	it('renders an <h1 align="center"> block as a real <h1>', () => {
		const container = renderMarkdown(`<h1 align="center">Hello logo</h1>`);
		const h1 = container.querySelector("h1");
		expect(h1).not.toBeNull();
		expect(h1?.textContent).toBe("Hello logo");
	});

	it('renders a <div align="center"> block as a real <div>', () => {
		const container = renderMarkdown(`<div align="center">centered</div>`);
		const div = container.querySelector('div[align="center"]');
		expect(div).not.toBeNull();
		expect(div?.textContent).toBe("centered");
	});

	it("renders <picture> with <source> + <img> fallback", () => {
		const container = renderMarkdown(
			`<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"/><img alt="Logo" src="light.png"/></picture>`,
		);
		expect(container.querySelector("picture")).not.toBeNull();
		expect(container.querySelector("picture source")).not.toBeNull();
		const img = container.querySelector("picture img");
		expect(img).not.toBeNull();
		expect(img?.getAttribute("alt")).toBe("Logo");
		expect(img?.getAttribute("src")).toBe("light.png");
	});

	it("renders standalone <img> tags with src and alt", () => {
		const container = renderMarkdown(`<img src="screenshot.png" alt="Demo screenshot"/>`);
		const img = container.querySelector("img");
		expect(img).not.toBeNull();
		// Relative paths render as-is — only external http(s) URLs get proxied.
		expect(img?.getAttribute("src")).toBe("screenshot.png");
		expect(img?.getAttribute("alt")).toBe("Demo screenshot");
	});

	it("routes external https <img> URLs through /_vercel/image", () => {
		const container = renderMarkdown(
			`<img src="https://raw.githubusercontent.com/foo/bar/main/logo.png" alt="logo"/>`,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe(
			"/_vercel/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffoo%2Fbar%2Fmain%2Flogo.png&w=1024&q=75",
		);
	});

	it("routes external markdown ![](url) images through /_vercel/image", () => {
		const container = renderMarkdown(`![logo](https://img.shields.io/badge/x-y-blue.svg)`);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe(
			"/_vercel/image?url=https%3A%2F%2Fimg.shields.io%2Fbadge%2Fx-y-blue.svg&w=1024&q=75",
		);
	});

	it("renders <br/> as a real line break", () => {
		const container = renderMarkdown(`line one<br/>line two`);
		expect(container.querySelector("br")).not.toBeNull();
	});

	it("renders the Opik README banner (centered h1 + picture + img)", () => {
		const opikBanner = `<h1 align="center">
<a href="https://www.comet.com/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="dark.svg"/>
<img alt="Comet Opik logo" src="light.svg" width="200"/>
</picture>
</a>
<br/>OpenClaw Opik Observability Plugin
</h1>`;
		const container = renderMarkdown(opikBanner);
		expect(container.querySelector("h1")).not.toBeNull();
		expect(container.querySelector("picture")).not.toBeNull();
		const img = container.querySelector("img");
		expect(img?.getAttribute("alt")).toBe("Comet Opik logo");
		// And the escaped tag must NOT be present as literal text anywhere.
		expect(container.textContent ?? "").not.toContain("<picture>");
	});
});

describe("MarkdownPreview — standard markdown still renders", () => {
	it("renders ATX headings", () => {
		const container = renderMarkdown(`## Why This Plugin`);
		const h2 = container.querySelector("h2");
		expect(h2?.textContent).toBe("Why This Plugin");
	});

	it("renders markdown links", () => {
		const container = renderMarkdown(`[Opik](https://example.com/opik)`);
		const a = container.querySelector("a");
		expect(a?.getAttribute("href")).toBe("https://example.com/opik");
		expect(a?.textContent).toBe("Opik");
	});

	it("renders inline code", () => {
		const container = renderMarkdown("Use `@opik/opik-openclaw` now.");
		const code = container.querySelector("code");
		expect(code?.textContent).toBe("@opik/opik-openclaw");
	});

	it("renders unordered lists", () => {
		const container = renderMarkdown(`- one\n- two\n- three`);
		const items = container.querySelectorAll("li");
		expect(items.length).toBe(3);
		expect(items[0].textContent).toBe("one");
	});

	it("renders GFM tables", () => {
		const container = renderMarkdown(
			["| Key | Value |", "| --- | ----- |", "| a   | 1     |", "| b   | 2     |"].join("\n"),
		);
		expect(container.querySelector("table")).not.toBeNull();
		expect(container.querySelectorAll("tbody tr").length).toBe(2);
	});

	it("renders fenced code blocks as <pre><code>", () => {
		const container = renderMarkdown("```ts\nconst x = 1;\n```");
		const code = container.querySelector("pre code");
		expect(code).not.toBeNull();
		expect(code?.textContent).toContain("const x = 1;");
	});
});

describe("MarkdownPreview — syntax highlighting", () => {
	it("shiki-highlights fenced code blocks (produces colored <span> tokens)", async () => {
		const { container } = render(
			<MarkdownPreview>{"```ts\nconst x: number = 1;\n```"}</MarkdownPreview>,
		);

		await waitFor(
			() => {
				const pre = container.querySelector("pre");
				// Shiki wraps the output in <pre class="shiki ..."> and tokens are
				// <span style="color:#...">.
				expect(pre?.className ?? "").toMatch(/shiki/);
				const coloredSpans = container.querySelectorAll("pre span[style*='color']");
				expect(coloredSpans.length).toBeGreaterThan(0);
			},
			{ timeout: 8000 },
		);

		// Raw code text must still be present after highlighting
		expect(container.querySelector("pre")?.textContent).toContain("const x");
	});

	it("leaves the highlight prop honored — highlight={false} renders plain <pre><code>", () => {
		const { container } = render(
			<MarkdownPreview highlight={false}>{"```ts\nconst x = 1;\n```"}</MarkdownPreview>,
		);
		const pre = container.querySelector("pre");
		// No shiki class, no colored spans
		expect(pre?.className ?? "").not.toMatch(/shiki/);
		expect(container.querySelectorAll("pre span[style*='color']").length).toBe(0);
		expect(pre?.textContent).toContain("const x = 1;");
	});
});

describe("MarkdownPreview — sanitization of malicious HTML", () => {
	it("strips <script> tags", () => {
		const container = renderMarkdown(`hello<script>window.__pwn = 1;</script>world`);
		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent ?? "").not.toContain("window.__pwn");
	});

	it("strips onerror handlers on <img>", () => {
		const container = renderMarkdown(`<img src="x" onerror="window.__pwn = 1" alt="x"/>`);
		const img = container.querySelector("img");
		// The img itself can render; the handler must be gone.
		expect(img?.getAttribute("onerror")).toBeNull();
	});

	it.each([
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"vbscript:msgbox(1)",
	])("strips unsafe hrefs on anchors: %s", (unsafeHref) => {
		const container = renderMarkdown(`<a href="${unsafeHref}">click</a>`);
		const a = container.querySelector("a");
		// Either the href is removed entirely or rewritten; it must not keep an executable scheme.
		const href = a?.getAttribute("href") ?? "";
		expect(href).not.toMatch(/^\s*(javascript|data|vbscript):/i);
	});
});
