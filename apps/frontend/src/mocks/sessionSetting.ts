export function sessionSettingIsOn(key: string): boolean {
  return (
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem(key) !== null
  );
}
