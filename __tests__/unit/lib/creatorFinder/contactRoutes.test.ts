import { extractContactRoutes } from "@/lib/creatorFinder/contactRoutes";

describe("extractContactRoutes", () => {
  it("finds plain and disguised emails, and quotes the words each came from", () => {
    const routes = extractContactRoutes({
      bio: "🎧 phonk edits\nbookings: mgmt.phonk@gmail.com\nparcerias: joao [at] gmail [dot] com",
    });
    expect(routes.filter((r) => r.kind === "email")).toEqual([
      { kind: "email", value: "mgmt.phonk@gmail.com", quote: "mgmt.phonk@gmail.com" },
      { kind: "email", value: "joao@gmail.com", quote: "joao [at] gmail [dot] com" },
    ]);
  });

  it("keeps the website field and links in the bio, without repeating an email's domain as a link", () => {
    const routes = extractContactRoutes({ bio: "contato: me@site.com · linktr.ee/funkboy", website: "https://beacons.ai/funkboy" });
    expect(routes.filter((r) => r.kind === "link").map((r) => r.value)).toEqual([
      "https://linktr.ee/funkboy",
      "https://beacons.ai/funkboy",
    ]);
  });

  it("reads WhatsApp links as WhatsApp, not as a website", () => {
    const routes = extractContactRoutes({ bio: "Whats: wa.me/5511999998888" });
    expect(routes).toEqual([{ kind: "whatsapp", value: "https://wa.me/5511999998888", quote: "wa.me/5511999998888" }]);
  });

  it("notices when a creator asks for DMs, in English or Portuguese", () => {
    expect(extractContactRoutes({ bio: "DM for collabs" }).map((r) => r.kind)).toEqual(["dm"]);
    expect(extractContactRoutes({ bio: "chama na DM pra parceria" }).map((r) => r.kind)).toEqual(["dm"]);
  });

  it("finds nothing in a bio with no route, rather than guessing one", () => {
    expect(extractContactRoutes({ bio: "just vibes 🚗💨", website: null })).toEqual([]);
    expect(extractContactRoutes({})).toEqual([]);
  });

  it("only ever returns text that is really in the bio", () => {
    const bio = "mgmt: Team.Funk@Label.com.br | yt: youtube.com/@funk | DM me";
    for (const r of extractContactRoutes({ bio })) expect(bio).toContain(r.quote);
  });
});
