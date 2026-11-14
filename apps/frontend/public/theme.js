const storedTheme = window.localStorage.getItem("discoin-theme");
if (storedTheme === "light" || storedTheme === "dark") {
  document.documentElement.dataset.theme = storedTheme;
}
