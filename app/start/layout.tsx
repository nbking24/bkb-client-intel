// Public Project Questionnaire layout. No auth, no dashboard chrome.
export const metadata = {
  title: 'Project Questionnaire | Brett King Builder',
  description: 'Tell us about your project before we meet.',
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Golos+Text:wght@400;500;600&display=swap"
      />
      {children}
    </>
  );
}
