export function GenericNotFoundPage() {
  return (
    <main className="border-b border-[color:var(--line)] bg-[color:var(--bg)]">
      <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
        <div className="flex max-w-[840px] flex-col gap-4">
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-4xl font-black leading-[0.98] text-[color:var(--ink)] sm:text-5xl">
              We couldn't find that page.
            </h1>
            <p className="max-w-xl text-base leading-7 text-[color:var(--ink-soft)] sm:text-lg">
              We couldn't find a skill, plugin, or profile at this URL. Try search, browse the
              catalog, or publish the thing you expected to see here.
            </p>
          </div>
        </div>

        <img
          src="/404-lobster-detective.jpg"
          alt="A lobster detective inspecting an empty 404 package crate."
          className="aspect-[16/9] w-full max-w-[920px] rounded-[var(--r-md)] border border-[color:var(--line)] object-cover object-left shadow-[var(--shadow-hover)]"
          loading="lazy"
        />
      </section>
    </main>
  );
}
