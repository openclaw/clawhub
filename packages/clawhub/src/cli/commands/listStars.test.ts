/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRoutes } from "../../schema/index.js";
import type { GlobalOpts } from "../types";

vi.mock("../authToken.js", () => ({
    requireAuthToken: vi.fn(async () => "tkn"),
}));

vi.mock("../registry.js", () => ({
    getRegistry: vi.fn(async () => "https://clawhub.ai"),
}));

const mockApiRequest = vi.fn();

const mockFail = vi.fn((message: string) => {
    throw new Error(message);
});

const mockLog = vi.spyOn(console, "log").mockImplementation(() => { });

const mockSpinnerSucceed = vi.fn();
const mockSpinnerFail = vi.fn();

vi.mock("../ui.js", () => ({
    createSpinner: vi.fn(() => ({ succeed: mockSpinnerSucceed, fail: mockSpinnerFail })),
    fail: (message: string) => mockFail(message),
    formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const mockRegistryUrl = vi.fn((path: string, registry: string) => {
    const base = registry.endsWith("/") ? registry : `${registry}/`;
    const relative = path.startsWith("/") ? path.slice(1) : path;
    return new URL(relative, base);
});

vi.mock("../../http.js", () => ({
    apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
        mockApiRequest(registry, args, schema),
    registryUrl: (...args: [string, string]) => mockRegistryUrl(...args),
}));

const { cmdListStars } = await import("./listStars.js");

function makeOpts(): GlobalOpts {
    return {
        workdir: "/work",
        dir: "/work/skills",
        site: "https://clawhub.ai",
        registry: "https://clawhub.ai",
        registrySource: "default",
    };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe("cmdListStars", () => {
    it("calls GET /api/v1/stars with auth token", async () => {
        mockApiRequest.mockResolvedValue({ items: [] });

        await cmdListStars(makeOpts());

        const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
        const url = new URL(String(requestArgs?.url));
        expect(requestArgs?.method).toBe("GET");
        expect(url.pathname).toBe(ApiRoutes.stars);
        expect(requestArgs?.token).toBe("tkn");
    });

    it("shows success message with correct count for empty list", async () => {
        mockApiRequest.mockResolvedValue({ items: [] });

        await cmdListStars(makeOpts());

        expect(mockSpinnerSucceed).toHaveBeenCalledWith("Found 0 starred skills in your highlights");
    });

    it("shows singular form for one starred skill", async () => {
        mockApiRequest.mockResolvedValue({
            items: [
                {
                    slug: "my-skill",
                    displayName: "My Skill",
                    tags: [],
                    stats: {},
                    createdAt: 1710000000000,
                    updatedAt: 1710000000000,
                },
            ],
        });

        await cmdListStars(makeOpts());

        expect(mockSpinnerSucceed).toHaveBeenCalledWith("Found 1 starred skill in your highlights");
    });

    it("shows plural form for multiple starred skills", async () => {
        mockApiRequest.mockResolvedValue({
            items: [
                {
                    slug: "skill-one",
                    displayName: "Skill One",
                    tags: [],
                    stats: {},
                    createdAt: 1710000000000,
                    updatedAt: 1710000000000,
                },
                {
                    slug: "skill-two",
                    displayName: "Skill Two",
                    tags: [],
                    stats: {},
                    createdAt: 1710000000000,
                    updatedAt: 1710000000000,
                },
            ],
        });

        await cmdListStars(makeOpts());

        expect(mockSpinnerSucceed).toHaveBeenCalledWith("Found 2 starred skills in your highlights");
    });

    it("calls spinner fail and rethrows on API error", async () => {
        mockApiRequest.mockRejectedValue(new Error("Unauthorized"));

        await expect(cmdListStars(makeOpts())).rejects.toThrow("Unauthorized");
        expect(mockSpinnerFail).toHaveBeenCalledWith("Unauthorized");
    });
    
    it("prints each starred skill with slug and display name", async () => {
        mockApiRequest.mockResolvedValue({
            items: [
                { slug: "skill-one", displayName: "Skill One", tags: [], stats: {}, createdAt: 0, updatedAt: 0 },
                { slug: "skill-two", displayName: "Skill Two", tags: [], stats: {}, createdAt: 0, updatedAt: 0 },
            ],
        });

        await cmdListStars(makeOpts());

        expect(mockLog).toHaveBeenCalledWith("skill-one  Skill One");
        expect(mockLog).toHaveBeenCalledWith("skill-two  Skill Two");
    });

    it("prints nothing extra for empty list", async () => {
        mockApiRequest.mockResolvedValue({ items: [] });

        await cmdListStars(makeOpts());

        expect(mockLog).not.toHaveBeenCalled();
    });

    it("passes limit query param when provided", async () => {
        mockApiRequest.mockResolvedValue({ items: [] });

        await cmdListStars(makeOpts(), { limit: 10 });

        const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
        const url = new URL(String(requestArgs?.url));
        expect(url.searchParams.get("limit")).toBe("10");
    });

    it("does not pass limit query param when not provided", async () => {
        mockApiRequest.mockResolvedValue({ items: [] });

        await cmdListStars(makeOpts());

        const [, requestArgs] = mockApiRequest.mock.calls[0] ?? [];
        const url = new URL(String(requestArgs?.url));
        expect(url.searchParams.get("limit")).toBeNull();
    });
});