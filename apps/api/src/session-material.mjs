// Session-only introduction; never modifies the saved presentation.
export function withWelcomeSlide(material, title = material.title) {
  return { ...material, slides: [
    { type: 'cover', title: String(title).trim(), welcomeScreen: true },
    ...material.slides,
  ] };
}
