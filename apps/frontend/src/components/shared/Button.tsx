import type { ComponentProps } from "preact";
import "./Button.scss";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger";

type ButtonProps = ComponentProps<"button"> & {
  variant: ButtonVariant;
};

export function Button({ variant, class: className, ...rest }: ButtonProps) {
  const classes = ["button", `button--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return <button type="button" class={classes} {...rest} />;
}
