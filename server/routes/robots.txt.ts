import { defineEventHandler } from "h3";

const robots = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:
`;

export default defineEventHandler(() => {
  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
});
