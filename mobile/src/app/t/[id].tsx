import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Link, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addExpense,
  addPerson,
  centsToEuro,
  computeBalances,
  isPaymentCompleted,
  movePerson,
  parseAmount,
  recordPayment,
  removeExpense,
  renamePerson,
  settle,
  unrecordPayment,
  t,
  tripFileJson,
  updateExpense,
  type Expense,
  type NewExpenseInput,
  type Trip,
} from "../../domain";
import { loadPhotoPin } from "../../api/photoSession";
import { apiBaseUrl } from "../../api/client";
import { Moments } from "../../components/moments";
import { useTrip } from "../../hooks/useTrip";
import { useTranslation } from "../../i18n";
import { Colors, type ColorTheme } from "../../constants/theme";

function createExpenseId(): string {
  return `expense-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ExpenseDraft = {
  description: string;
  amount: string;
  payer: string;
  participants: Record<string, boolean>;
  weighted: boolean;
  weights: Record<string, string>;
};

function makeExpenseDraft(trip: Trip, expense?: Expense): ExpenseDraft {
  const participants = Object.fromEntries(
    trip.people.map((person) => [person, expense ? expense.participants.includes(person) : true]),
  ) as Record<string, boolean>;
  const weights = Object.fromEntries(
    trip.people.map((person) => {
      const participantIndex = expense?.participants.indexOf(person) ?? -1;
      const weight = participantIndex >= 0 ? expense?.weights?.[participantIndex] ?? 1 : 1;
      return [person, String(weight)];
    }),
  ) as Record<string, string>;

  return {
    description: expense?.description ?? "",
    amount: expense ? (expense.amount_cents / 100).toFixed(2) : "",
    payer: expense?.payer ?? trip.people[0] ?? "",
    participants,
    weighted: expense?.weights !== undefined,
    weights,
  };
}

function formatParticipants(expense: Expense): string {
  const parts = expense.participants.join(", ");
  if (!expense.weights) {
    return parts;
  }
  const weighted = expense.participants.map((person, index) => `${person}:${expense.weights?.[index] ?? 1}`);
  return `${parts} · ${weighted.join(" ")}`;
}

type Styles = ReturnType<typeof makeStyles>;

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: Styles }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipButton({
  label,
  selected,
  onPress,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function StepButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: Styles }) {
  return (
    <Pressable onPress={onPress} style={styles.stepButton} accessibilityRole="button">
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  styles,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  styles: Styles;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

function ErrorBanner({ message, styles }: { message: string | null; styles: Styles }) {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

export default function TripScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const tripId = Array.isArray(params.id) ? params.id[0] : params.id ?? null;
  const { trip, loading, saving, error, reload, mutate } = useTrip(tripId);
  const [personName, setPersonName] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<{ old: string; draft: string } | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [photoPin, setPhotoPin] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);

  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tripUrl = useMemo(() => {
    if (!tripId) {
      return "";
    }
    return `${apiBaseUrl()}/t/${tripId}`;
  }, [tripId]);

  useEffect(() => {
    if (!tripId) {
      return;
    }
    let cancelled = false;
    void loadPhotoPin(tripId).then((pin) => {
      if (!cancelled) {
        setPhotoPin(pin ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const handleShareTrip = async () => {
    if (!tripUrl) {
      return;
    }
    try {
      await Share.share({ message: t("Join the trip on Fair Share: {{url}}", { url: tripUrl }) });
    } catch {
      // User cancelled or share failed.
    }
  };

  const handleSharePin = async () => {
    if (!photoPin) {
      Alert.alert(t("No PIN"), t("Photos on this trip are not locked."));
      return;
    }
    try {
      await Share.share({ message: t("Photos PIN for the trip: {{pin}}", { pin: photoPin }) });
    } catch {
      // User cancelled or share failed.
    }
  };

  const handleExportJson = async () => {
    if (!trip) {
      return;
    }
    try {
      await Share.share({ message: tripFileJson(trip), title: `${trip.name} - Fair Share` });
    } catch {
      // User cancelled or share failed.
    }
  };

  const editingExpense = useMemo(
    () => trip?.expenses.find((expense) => expense.id === editingExpenseId) ?? null,
    [editingExpenseId, trip],
  );

  useEffect(() => {
    if (!trip) {
      setExpenseDraft(null);
      return;
    }
    if (editingExpenseId && editingExpense) {
      setExpenseDraft(makeExpenseDraft(trip, editingExpense));
      return;
    }
    if (editingExpenseId && !editingExpense) {
      setEditingExpenseId(null);
    }
    setExpenseDraft(makeExpenseDraft(trip));
  }, [editingExpense, editingExpenseId, trip]);

  const balances = useMemo(() => {
    if (!trip) {
      return null;
    }
    return computeBalances(trip);
  }, [trip]);

  const payments = useMemo(() => {
    if (!balances) {
      return [];
    }
    return settle(balances);
  }, [balances]);

  const handleAddPerson = async () => {
    if (!trip) {
      return;
    }

    const name = personName.trim();
    if (!name) {
      setPersonError(t("Enter a person name"));
      return;
    }

    setPersonError(null);
    const success = await mutate((current) => addPerson(current, name));
    if (success) {
      setPersonName("");
    }
  };

  const handleRenamePerson = async () => {
    if (!trip || !editingPerson) {
      return;
    }

    const name = editingPerson.draft.trim();
    if (!name) {
      setPersonError(t("Enter a person name"));
      return;
    }
    if (name === editingPerson.old) {
      setEditingPerson(null);
      return;
    }

    setPersonError(null);
    const success = await mutate((current) => renamePerson(current, editingPerson.old, name));
    if (success) {
      setEditingPerson(null);
    }
  };

  const handleMovePerson = async (person: string, direction: "up" | "down") => {
    if (!trip) {
      return;
    }
    setPersonError(null);
    await mutate((current) => movePerson(current, person, direction));
  };

  const handleRecordPayment = async (payment: { frm: string; to: string; amount_cents: number }) => {
    if (!trip) {
      return;
    }
    const next = isPaymentCompleted(trip, payment)
      ? unrecordPayment(trip, payment)
      : recordPayment(trip, payment);
    await mutate(() => next);
  };

  const handleRemoveExpense = (expenseId: string, description: string) => {
    if (!trip) {
      return;
    }

    Alert.alert(t("Remove expense?"), description, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Remove"),
        style: "destructive",
        onPress: () => {
          void mutate((current) => removeExpense(current, expenseId));
          if (editingExpenseId === expenseId) {
            setEditingExpenseId(null);
          }
        },
      },
    ]);
  };

  const handleEditExpense = (expense: Expense) => {
    if (!trip) {
      return;
    }

    setFormError(null);
    setEditingExpenseId(expense.id);
    setExpenseDraft(makeExpenseDraft(trip, expense));
  };

  const handleCancelEdit = () => {
    if (!trip) {
      return;
    }

    setEditingExpenseId(null);
    setExpenseDraft(makeExpenseDraft(trip));
    setFormError(null);
  };

  const handleSaveExpense = async () => {
    if (!trip || !expenseDraft) {
      return;
    }

    const description = expenseDraft.description.trim();
    if (!description) {
      setFormError(t("Enter an expense description"));
      return;
    }

    if (!expenseDraft.payer) {
      setFormError(t("Choose who paid"));
      return;
    }

    const participants = trip.people.filter((person) => expenseDraft.participants[person]);
    if (participants.length === 0) {
      setFormError(t("Select at least one participant"));
      return;
    }

    let amountCents: number;
    try {
      amountCents = parseAmount(expenseDraft.amount);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t("Invalid amount"));
      return;
    }

    let input: NewExpenseInput;
    try {
      input = {
        description,
        payer: expenseDraft.payer,
        amount_cents: amountCents,
        participants,
        ...(expenseDraft.weighted
          ? {
              weights: participants.map((person) => {
                const raw = expenseDraft.weights[person] ?? "1";
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                  throw new Error(`Weight for ${person} must be a positive integer`);
                }
                return parsed;
              }),
            }
          : {}),
      };
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t("Invalid weights"));
      return;
    }

    const expenseId = editingExpenseId ?? createExpenseId();
    const success = await mutate((current) =>
      editingExpenseId ? updateExpense(current, editingExpenseId, input) : addExpense(current, input, expenseId),
    );
    if (success) {
      setEditingExpenseId(null);
      setExpenseDraft(makeExpenseDraft(trip));
      setFormError(null);
    }
  };

  const toggleParticipant = (person: string) => {
    setExpenseDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        participants: {
          ...current.participants,
          [person]: !current.participants[person],
        },
      };
    });
  };

  const updateWeight = (person: string, value: string) => {
    setExpenseDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        weights: {
          ...current.weights,
          [person]: value,
        },
      };
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.mutedText}>Loading trip…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.title}>Trip not found</Text>
          <ErrorBanner styles={styles} message={error} />
          <View style={styles.rowGap}>
            <StepButton styles={styles} label={t("Retry")} onPress={() => void reload()} />
            <Link href="/" asChild>
              <Pressable style={styles.secondaryButton} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Open another trip</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const draft = expenseDraft ?? makeExpenseDraft(trip);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>{trip.name}</Text>
            <Text style={styles.mutedText}>{t("Trip ID")} {tripId}</Text>
          </View>
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton} accessibilityRole="button" accessibilityLabel={t("Change trip")}>
              <Text style={styles.secondaryButtonText}>{t("Change trip")}</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={() => void handleShareTrip()} accessibilityRole="button" accessibilityLabel={t("Share trip link")}>
            <Text style={styles.secondaryButtonText}>{t("Share trip")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void handleSharePin()} accessibilityRole="button" accessibilityLabel={t("Share photos PIN")}>
            <Text style={styles.secondaryButtonText}>{t("Share PIN")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setQrVisible(true)} accessibilityRole="button" accessibilityLabel={t("Show QR code for trip link")}>
            <Text style={styles.secondaryButtonText}>{t("Show QR")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void handleExportJson()} accessibilityRole="button" accessibilityLabel={t("Export trip JSON")}>
            <Text style={styles.secondaryButtonText}>{t("Export JSON")}</Text>
          </Pressable>
        </View>

        <ErrorBanner styles={styles} message={error} />
        <ErrorBanner styles={styles} message={personError} />
        <ErrorBanner styles={styles} message={formError} />

        <Section styles={styles} title={t("People")}>
          <View style={styles.rowWrap}>
            {trip.people.map((person, index) => (
              <Pressable
                key={person}
                style={styles.personTag}
                onPress={() => setEditingPerson({ old: person, draft: person })}
                onLongPress={() =>
                  Alert.alert(
                    person,
                    undefined,
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Rename"),
                        onPress: () => setEditingPerson({ old: person, draft: person }),
                      },
                      ...(index > 0
                        ? [{ text: t("Move up"), onPress: () => void handleMovePerson(person, "up") }]
                        : []),
                      ...(index < trip.people.length - 1
                        ? [{ text: t("Move down"), onPress: () => void handleMovePerson(person, "down") }]
                        : []),
                    ],
                    { cancelable: true },
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t("Edit {{name}}", { name: person })}
              >
                <Text style={styles.personTagText}>{person}</Text>
              </Pressable>
            ))}
          </View>

          {editingPerson ? (
            <View style={styles.fieldRow}>
              <View style={styles.flexGrow}>
                <Field
                  styles={styles}
                  label={t("Rename {{name}}", { name: editingPerson.old })}
                  value={editingPerson.draft}
                  onChangeText={(value) => setEditingPerson({ ...editingPerson, draft: value })}
                  placeholder={t("Name")}
                />
              </View>
              <StepButton styles={styles} label={t("Save")} onPress={() => void handleRenamePerson()} />
              <StepButton styles={styles} label={t("Cancel")} onPress={() => setEditingPerson(null)} />
            </View>
          ) : null}

          <View style={styles.fieldRow}>
            <View style={styles.flexGrow}>
              <Field styles={styles}
                label={t("Add person")}
                value={personName}
                onChangeText={(value) => {
                  setPersonName(value);
                  setPersonError(null);
                }}
                placeholder={t("Name")}
              />
            </View>
            <StepButton styles={styles} label={t("Add")} onPress={() => void handleAddPerson()} />
          </View>
        </Section>

        <Section styles={styles} title={editingExpenseId ? t("Edit expense") : t("Add expense")}>
          <Field styles={styles}
            label={t("Description")}
            value={draft.description}
            onChangeText={(value) =>
              setExpenseDraft((current) => (current ? { ...current, description: value } : current))
            }
            placeholder={t("Dinner")}
          />
          <Field styles={styles}
            label={t("Amount")}
            value={draft.amount}
            onChangeText={(value) => setExpenseDraft((current) => (current ? { ...current, amount: value } : current))}
            placeholder={t("40.00")}
            keyboardType="decimal-pad"
          />

          <Text style={styles.fieldLabel}>{t("Who paid")}</Text>
          <View style={styles.rowWrap}>
            {trip.people.map((person) => (
              <ChipButton
                key={person}
                label={person}
                selected={draft.payer === person}
                onPress={() =>
                  setExpenseDraft((current) => (current ? { ...current, payer: person } : current))
                }
                styles={styles}
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>{t("Split with")}</Text>
          <View style={styles.rowWrap}>
            {trip.people.map((person) => (
              <ChipButton
                key={person}
                label={person}
                selected={draft.participants[person] ?? false}
                onPress={() => toggleParticipant(person)}
                styles={styles}
              />
            ))}
          </View>

          <ChipButton
            label={draft.weighted ? t("Weighted split") : t("Equal split")}
            selected={draft.weighted}
            onPress={() =>
              setExpenseDraft((current) =>
                current ? { ...current, weighted: !current.weighted } : current,
              )
            }
            styles={styles}
          />

          {draft.weighted ? (
            <View style={styles.weightList}>
              {trip.people.map((person) =>
                draft.participants[person] ? (
                  <View key={person} style={styles.weightRow}>
                    <Text style={styles.weightName}>{person}</Text>
                    <TextInput
                      value={draft.weights[person] ?? "1"}
                      onChangeText={(value) => updateWeight(person, value)}
                      keyboardType="number-pad"
                      style={[styles.input, styles.weightInput]}
                    />
                  </View>
                ) : null,
              )}
            </View>
          ) : null}

          <View style={styles.rowGap}>
            <StepButton styles={styles} label={saving ? t("Saving…") : editingExpenseId ? t("Save changes") : t("Add expense")} onPress={() => void handleSaveExpense()} />
            {editingExpenseId ? (
              <Pressable style={styles.secondaryButton} onPress={handleCancelEdit} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>{t("Cancel edit")}</Text>
              </Pressable>
            ) : null}
          </View>
        </Section>

        <Section styles={styles} title={t("Expenses")}>
          {trip.expenses.length === 0 ? <Text style={styles.mutedText}>{t("No expenses yet. Add one above.")}</Text> : null}
          <View style={styles.listGap}>
            {trip.expenses.map((expense) => (
              <View key={expense.id} style={styles.card}>
                <Text style={styles.cardTitle}>{expense.description}</Text>
                <Text style={styles.mutedText}>{expense.payer} {t("paid")} {centsToEuro(expense.amount_cents)}</Text>
                <Text style={styles.cardBody}>{formatParticipants(expense)}</Text>
                <View style={styles.rowGap}>
                  <StepButton styles={styles} label={t("Edit")} onPress={() => handleEditExpense(expense)} />
                  <Pressable
                    style={styles.dangerButton}
                    onPress={() => handleRemoveExpense(expense.id, expense.description)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dangerButtonText}>{t("Remove")}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </Section>

        <Section styles={styles} title={t("Balances")}>
          {trip.expenses.length === 0 ? null : (
            <Text style={styles.explainer}>{t("Positive = owed to this person. Negative = this person owes money.")}</Text>
          )}
          <View style={styles.listGap}>
            {Object.entries(balances ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([person, amount]) => (
                <View key={person} style={styles.balanceRow}>
                  <Text style={styles.cardTitle}>{person}</Text>
                  <Text style={[styles.balanceValue, amount >= 0 ? styles.positive : styles.negative]}>
                    {centsToEuro(amount)}
                  </Text>
                </View>
              ))}
          </View>
        </Section>

        <Section styles={styles} title={t("Who pays whom")}>
          {payments.length === 0 ? <Text style={styles.mutedText}>{t("All settled — no payments needed.")}</Text> : null}
          <View style={styles.listGap}>
            {payments.map((payment) => {
              const completed = trip ? isPaymentCompleted(trip, payment) : false;
              return (
                <Pressable
                  key={`${payment.frm}-${payment.to}-${payment.amount_cents}`}
                  style={[styles.balanceRow, completed && styles.completedRow]}
                  onPress={() => void handleRecordPayment(payment)}
                  accessibilityRole="button"
                  accessibilityLabel={completed ? t("Unmark payment") : t("Mark as paid")}
                >
                  <Text style={[styles.cardBody, completed && styles.completedText]}>
                    {payment.frm} → {payment.to}
                  </Text>
                  <Text style={[styles.balanceValue, completed && styles.completedText]}>
                    {centsToEuro(payment.amount_cents)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section styles={styles} title="Moments">
          {tripId ? <Moments tripId={tripId} trip={trip} onTripLocked={() => void reload()} /> : null}
        </Section>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={qrVisible}
        onRequestClose={() => setQrVisible(false)}
        accessibilityLabel="Trip QR code"
      >
        <View style={[styles.centered, { backgroundColor: "rgba(0,0,0,0.4)" }]}>
          <View style={[styles.section, { alignItems: "center" }]}>
            {tripUrl ? (
              <QRCode
                value={tripUrl}
                size={220}
                color={colors.text}
                backgroundColor={colors.background}
              />
            ) : null}
            <Text style={styles.mutedText}>{t("Scan to open this trip.")}</Text>
            <Pressable style={styles.stepButton} onPress={() => setQrVisible(false)} accessibilityRole="button">
              <Text style={styles.stepButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ColorTheme) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
  },
  mutedText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  section: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-end",
  },
  flexGrow: {
    flex: 1,
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  rowGap: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  listGap: {
    gap: 12,
  },
  personTag: {
    backgroundColor: colors.backgroundElement,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  personTagText: {
    color: colors.tint,
    fontWeight: "600",
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  chipSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipText: {
    color: colors.text,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: colors.background,
  },
  stepButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: {
    color: colors.background,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.backgroundElement,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: colors.tint,
    fontWeight: "700",
  },
  dangerButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.negative,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    color: colors.background,
    fontWeight: "700",
  },
  errorBanner: {
    backgroundColor: colors.negative,
    borderRadius: 12,
    padding: 12,
  },
  errorBannerText: {
    color: colors.background,
    fontWeight: "600",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: 14,
    gap: 8,
    backgroundColor: colors.background,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  cardBody: {
    color: colors.textSecondary,
  },
  explainer: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  balanceValue: {
    fontWeight: "700",
    color: colors.text,
  },
  positive: {
    color: colors.positive,
  },
  negative: {
    color: colors.negative,
  },
  completedRow: {
    opacity: 0.55,
  },
  completedText: {
    textDecorationLine: "line-through",
  },
  weightList: {
    gap: 8,
  },
  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  weightName: {
    minWidth: 90,
    fontWeight: "600",
    color: colors.text,
  },
  weightInput: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  });
}
