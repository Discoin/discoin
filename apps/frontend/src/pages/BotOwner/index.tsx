import type { ComponentChildren, Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { BotWithCurrencies, Currency } from "../../api/types.js";
import {
  currencyChoiceLabel,
  currencyLabel,
  currencyPickerOption,
} from "../../components/currency/currencyPickerOption.jsx";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { RequireLogin } from "../../components/session/RequireLogin.jsx";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { Picker, type PickerOption } from "../../components/shared/Picker.jsx";
import { findCurrency } from "../../lib/currencies.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest } from "../../lib/useRequest.js";
import { BotSections } from "./BotSections.jsx";
import { CurrencySections } from "./CurrencySections.jsx";
import { SwitchConfirm } from "./SwitchConfirm.jsx";
import {
  createUnsavedChanges,
  UnsavedChangesContext,
  type UnsavedChanges,
} from "./unsavedChanges.js";
import "./style.scss";

const SAVING_REASON =
  "Saving your changes. You can switch once the save finishes.";

interface Selection {
  botId: string;
  currencyId: string | null;
}

interface SelectionChange {
  target: string;
  selection: Selection;
  unsavedForms: string[];
}

function replaced(currencies: Currency[], updated: Currency): Currency[] {
  return currencies.map((currency) =>
    currency.id === updated.id ? updated : currency,
  );
}

function withCurrency(
  bots: BotWithCurrencies[],
  updated: Currency,
): BotWithCurrencies[] {
  return bots.map((bot) => ({
    ...bot,
    currencies: replaced(bot.currencies, updated),
  }));
}

function findBot(bots: BotWithCurrencies[], id: string): BotWithCurrencies {
  const bot = bots.find((candidate) => candidate.id === id);
  if (bot === undefined) throw new Error(`Unknown bot "${id}"`);

  return bot;
}

function pickableCurrencies(
  bot: BotWithCurrencies,
  selectedId: string | null,
): Currency[] {
  return bot.currencies
    .filter((currency) => currency.active || currency.id === selectedId)
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

function selectionOf(bot: BotWithCurrencies): Selection {
  const [first] = pickableCurrencies(bot, null);

  return { botId: bot.id, currencyId: first === undefined ? null : first.id };
}

function offersChoice(options: unknown[]): boolean {
  return options.length > 1;
}

function botPickerOption(bot: BotWithCurrencies): PickerOption {
  return { value: bot.id, text: bot.name, content: bot.name };
}

interface GroupProps {
  id: string;
  title: string;
  tracker: UnsavedChanges;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ComponentChildren;
}

function Group({ id, title, tracker, headingRef, children }: GroupProps) {
  const focusable = headingRef === undefined ? undefined : -1;

  return (
    <UnsavedChangesContext.Provider value={tracker}>
      <section class="owner-group" aria-labelledby={id}>
        <h2
          id={id}
          ref={headingRef}
          tabIndex={focusable}
          class="owner-group__title"
        >
          {title}
        </h2>
        {children}
      </section>
    </UnsavedChangesContext.Provider>
  );
}

function NoCurrency({ bot }: { bot: BotWithCurrencies }) {
  if (bot.currencies.length === 0) {
    return (
      <EmptyState title="This bot has no currency yet">
        <p>
          Ask a Discoin admin to add a currency to {bot.name}. The bot settings
          above still work.
        </p>
      </EmptyState>
    );
  }

  return (
    <EmptyState title="Every currency of this bot is inactive">
      <p>
        A Discoin admin has to reactivate a currency of {bot.name} before you
        can change its name or daily cap here. The bot settings above still
        work.
      </p>
    </EmptyState>
  );
}

function DeactivatedCurrency({ currency }: { currency: Currency }) {
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const message = messageRef.current;
    if (message === null) throw new Error("The inactive message didn't render");

    message.focus();
  }, []);

  return (
    <div ref={messageRef} tabIndex={-1} class="owner-group__message">
      <EmptyState title={`${currency.abbreviation} is inactive`}>
        <p>
          A Discoin admin deactivated {currencyLabel(currency)}. Its name, value
          and daily cap stay hidden here until an admin reactivates it. The bot
          settings above still work.
        </p>
      </EmptyState>
    </div>
  );
}

interface CurrencyContentProps {
  bot: BotWithCurrencies;
  currency: Currency | null;
  onCurrencyChanged: (currency: Currency) => void;
}

function CurrencyContent({
  bot,
  currency,
  onCurrencyChanged,
}: CurrencyContentProps) {
  if (currency === null) return <NoCurrency bot={bot} />;
  if (!currency.active) return <DeactivatedCurrency currency={currency} />;

  return (
    <CurrencySections
      key={currency.id}
      currency={currency}
      onCurrencyChanged={onCurrencyChanged}
    />
  );
}

interface OwnerWorkspaceProps {
  bots: BotWithCurrencies[];
  onCurrencyChanged: (currency: Currency) => void;
}

function OwnerWorkspace({ bots, onCurrencyChanged }: OwnerWorkspaceProps) {
  const [selection, setSelection] = useState(() => selectionOf(bots[0]));
  const [pendingSwitch, setPendingSwitch] = useState<SelectionChange | null>(
    null,
  );
  const [botSaving, setBotSaving] = useState(false);
  const [currencySaving, setCurrencySaving] = useState(false);
  const [botChanges] = useState(() => createUnsavedChanges(setBotSaving));
  const [currencyChanges] = useState(() =>
    createUnsavedChanges(setCurrencySaving),
  );
  const bot = findBot(bots, selection.botId);
  const currencies = pickableCurrencies(bot, selection.currencyId);
  const currency =
    selection.currencyId === null
      ? null
      : findCurrency(currencies, selection.currencyId);
  const showsBotPicker = offersChoice(bots);
  const showsCurrencyPicker = currency !== null && offersChoice(currencies);
  const unavailableReason =
    botSaving || currencySaving ? SAVING_REASON : undefined;
  const currencyHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingTakesFocus = useRef(false);

  useEffect(() => {
    if (!headingTakesFocus.current) return;

    headingTakesFocus.current = false;
    const heading = currencyHeadingRef.current;
    if (heading === null) throw new Error("The currency heading didn't render");

    heading.focus();
  }, [selection]);

  function applySelection(next: Selection) {
    const sameBot = next.botId === bot.id;
    headingTakesFocus.current =
      sameBot && !offersChoice(pickableCurrencies(bot, next.currencyId));
    setSelection(next);
  }

  function requestSwitch(change: SelectionChange) {
    if (change.unsavedForms.length === 0) applySelection(change.selection);
    else setPendingSwitch(change);
  }

  function chooseBot(botId: string) {
    const next = findBot(bots, botId);
    requestSwitch({
      target: next.name,
      selection: selectionOf(next),
      unsavedForms: [...botChanges.forms(), ...currencyChanges.forms()],
    });
  }

  function chooseCurrency(currencyId: string) {
    requestSwitch({
      target: currencyLabel(findCurrency(currencies, currencyId)),
      selection: { botId: bot.id, currencyId },
      unsavedForms: currencyChanges.forms(),
    });
  }

  function confirmSwitch(change: SelectionChange) {
    setPendingSwitch(null);
    applySelection(change.selection);
  }

  const botTitle = showsBotPicker ? "Bot" : `Bot: ${bot.name}`;
  const currencyTitle =
    showsCurrencyPicker || currency === null
      ? "Currency"
      : `Currency: ${currencyChoiceLabel(currency)}`;

  return (
    <>
      {(showsBotPicker || showsCurrencyPicker) && (
        <div class="owner-pickers">
          {showsBotPicker && (
            <Picker
              label="Bot"
              options={bots.map(botPickerOption)}
              value={bot.id}
              unavailableReason={unavailableReason}
              onChange={chooseBot}
            />
          )}
          {showsCurrencyPicker && (
            <Picker
              key={bot.id}
              label="Currency"
              options={currencies.map(currencyPickerOption)}
              value={currency.id}
              unavailableReason={unavailableReason}
              onChange={chooseCurrency}
            />
          )}
        </div>
      )}
      <Group id="bot-group" title={botTitle} tracker={botChanges}>
        <BotSections key={bot.id} bot={bot} />
      </Group>
      <Group
        id="currency-group"
        title={currencyTitle}
        tracker={currencyChanges}
        headingRef={currencyHeadingRef}
      >
        <CurrencyContent
          bot={bot}
          currency={currency}
          onCurrencyChanged={onCurrencyChanged}
        />
      </Group>
      {pendingSwitch !== null && (
        <SwitchConfirm
          target={pendingSwitch.target}
          unsavedForms={pendingSwitch.unsavedForms}
          onStay={() => setPendingSwitch(null)}
          onSwitch={() => confirmSwitch(pendingSwitch)}
        />
      )}
    </>
  );
}

function OwnedBots() {
  const owned = useRequest(() => api.listOwnedBots(), []);

  function replaceCurrency(updated: Currency) {
    owned.change((bots) => withCurrency(bots, updated));
  }

  return (
    <Loadable
      state={owned.state}
      label="your bots"
      onRetry={owned.reload}
      empty={{
        when: (bots) => bots.length === 0,
        title: "You don't own a bot yet",
        body: (
          <p>Ask a Discoin admin to register your bot and its currencies.</p>
        ),
      }}
    >
      {(bots) => (
        <OwnerWorkspace bots={bots} onCurrencyChanged={replaceCurrency} />
      )}
    </Loadable>
  );
}

export function BotOwner() {
  usePageTitle("Bot owner");

  return (
    <div class="page">
      <PageIntro title="Bot owner">
        Settings for your bots and the currencies they run. A bot's API token,
        webhook, blocked users and pending transactions cover all of its
        currencies. Name, value, liquidity and daily cap belong to one currency.
      </PageIntro>
      <RequireLogin access="user">{() => <OwnedBots />}</RequireLogin>
    </div>
  );
}
