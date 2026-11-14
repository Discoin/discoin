import logo from "../../assets/logo.png";
import "./Wordmark.scss";

export function Wordmark() {
  return (
    <span class="wordmark">
      <span class="visually-hidden">Discoin</span>
      <span aria-hidden="true">
        <span class="wordmark__d">
          <img src={logo} alt="" />
        </span>
        iscoin
      </span>
    </span>
  );
}
