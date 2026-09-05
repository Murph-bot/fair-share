import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addExpense,
  addPerson,
  centsToEuro,
  computeBalances,
  parseAmount,
  removeExpense,
  settle,
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
import { Colors } from "../../constants/theme";

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
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

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
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
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
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

function ErrorBanner({ message }: { message: string | null }) {
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
  const params = useLocalSearchParams<{ id?: string }>();
  const tripId = Array.isArray(params.id) ? params.id[0] : params.id ?? null;
  const { trip, loading, saving, error, reload, mutate } = useTrip(tripId);
  const [personName, setPersonName] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [photoPin, setPhotoPin] = useState<string | null>(null);

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
      await Share.share({ message: `Join the trip on Fair Share: ${tripUrl}` });
    } catch {
      // User cancelled or share failed.
    }
  };

  const handleSharePin = async () => {
    if (!photoPin) {
      Alert.alert("No PIN", "Photos on this trip are not locked.");
      return;
    }
    try {
      await Share.share({ message: `Photos PIN for the trip: ${photoPin}` });
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
      setPersonError("Enter a person name");
      return;
    }

    setPersonError(null);
    const success = await mutate((current) => addPerson(current, name));
    if (success) {
      setPersonName("");
    }
  };

  const handleRemoveExpense = (expenseId: string, description: string) => {
    if (!trip) {
      return;
    }

    Alert.alert("Remove expense?", description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
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
      setFormError("Enter an expense description");
      return;
    }

    if (!expenseDraft.payer) {
      setFormError("Choose who paid");
      return;
    }

    const participants = trip.people.filter((person) => expenseDraft.participants[person]);
    if (participants.length === 0) {
      setFormError("Select at least one participant");
      return;
    }

    let amountCents: number;
    try {
      amountCents = parseAmount(expenseDraft.amount);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Invalid amount");
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
      setFormError(caught instanceof Error ? caught.message : "Invalid weights");
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
          <ErrorBanner message={error} />
          <View style={styles.rowGap}>
            <StepButton label="Retry" onPress={() => void reload()} />
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
            <Text style={styles.mutedText}>Trip ID {tripId}</Text>
          </View>
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton} accessibilityRole="button" accessibilityLabel="Change trip">
              <Text style={styles.secondaryButtonText}>Change trip</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={() => void handleShareTrip()} accessibilityRole="button" accessibilityLabel="Share trip link">
            <Text style={styles.secondaryButtonText}>Share trip</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void handleSharePin()} accessibilityRole="button" accessibilityLabel="Share photos PIN">
            <Text style={styles.secondaryButtonText}>Share PIN</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void handleExportJson()} accessibilityRole="button" accessibilityLabel="Export trip JSON">
            <Text style={styles.secondaryButtonText}>Export JSON</Text>
          </Pressable>
        </View>

        <ErrorBanner message={error} />
        <ErrorBanner message={personError} />
        <ErrorBanner message={formError} />

        <Section title="People">
          <View style={styles.rowWrap}>
            {trip.people.map((person) => (
              <View key={person} style={styles.personTag}>
                <Text style={styles.personTagText}>{person}</Text>
              </View>
            ))}
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.flexGrow}>
              <Field
                label="Add person"
                value={personName}
                onChangeText={(value) => {
                  setPersonName(value);
                  setPersonError(null);
                }}
                placeholder="Name"
              />
            </View>
            <StepButton label="Add" onPress={() => void handleAddPerson()} />
          </View>
        </Section>

        <Section title={editingExpenseId ? "Edit expense" : "Add expense"}>
          <Field
            label="Description"
            value={draft.description}
            onChangeText={(value) =>
              setExpenseDraft((current) => (current ? { ...current, description: value } : current))
            }
            placeholder="Dinner"
          />
          <Field
            label="Amount"
            value={draft.amount}
            onChangeText={(value) => setExpenseDraft((current) => (current ? { ...current, amount: value } : current))}
            placeholder="40.00"
            keyboardType="decimal-pad"
          />

          <Text style={styles.fieldLabel}>Who paid</Text>
          <View style={styles.rowWrap}>
            {trip.people.map((person) => (
              <ChipButton
                key={person}
                label={person}
                selected={draft.payer === person}
                onPress={() =>
                  setExpenseDraft((current) => (current ? { ...current, payer: person } : current))
                }
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>Split with</Text>
          <View style={styles.rowWrap}>
            {trip.people.map((person) => (
              <ChipButton
                key={person}
                label={person}
                selected={draft.participants[person] ?? false}
                onPress={() => toggleParticipant(person)}
              />
            ))}
          </View>

          <ChipButton
            label={draft.weighted ? "Weighted split" : "Equal split"}
            selected={draft.weighted}
            onPress={() =>
              setExpenseDraft((current) =>
                current ? { ...current, weighted: !current.weighted } : current,
              )
            }
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
            <StepButton label={saving ? "Saving…" : editingExpenseId ? "Save changes" : "Add expense"} onPress={() => void handleSaveExpense()} />
            {editingExpenseId ? (
              <Pressable style={styles.secondaryButton} onPress={handleCancelEdit} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Cancel edit</Text>
              </Pressable>
            ) : null}
          </View>
        </Section>

        <Section title="Expenses">
          {trip.expenses.length === 0 ? <Text style={styles.mutedText}>No expenses yet. Add one above.</Text> : null}
          <View style={styles.listGap}>
            {trip.expenses.map((expense) => (
              <View key={expense.id} style={styles.card}>
                <Text style={styles.cardTitle}>{expense.description}</Text>
                <Text style={styles.mutedText}>{expense.payer} paid {centsToEuro(expense.amount_cents)}</Text>
                <Text style={styles.cardBody}>{formatParticipants(expense)}</Text>
                <View style={styles.rowGap}>
                  <StepButton label="Edit" onPress={() => handleEditExpense(expense)} />
                  <Pressable
                    style={styles.dangerButton}
                    onPress={() => handleRemoveExpense(expense.id, expense.description)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dangerButtonText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Balances">
          {trip.expenses.length === 0 ? null : (
            <Text style={styles.explainer}>Positive = owed to this person. Negative = this person owes money.</Text>
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

        <Section title="Who pays whom">
          {payments.length === 0 ? <Text style={styles.mutedText}>All settled — no payments needed.</Text> : null}
          <View style={styles.listGap}>
            {payments.map((payment) => (
              <View key={`${payment.frm}-${payment.to}-${payment.amount_cents}`} style={styles.balanceRow}>
                <Text style={styles.cardBody}>{payment.frm} → {payment.to}</Text>
                <Text style={styles.balanceValue}>{centsToEuro(payment.amount_cents)}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Moments">
          {tripId ? <Moments tripId={tripId} trip={trip} onTripLocked={() => void reload()} /> : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.light.background,
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
    color: Colors.light.text,
  },
  mutedText: {
    color: Colors.light.textSecondary,
    fontSize: 14,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  section: {
    backgroundColor: Colors.light.backgroundElement,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.light.rule,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.light.text,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.textSecondary,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.light.rule,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.light.background,
    color: Colors.light.text,
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
    backgroundColor: "#efe5d4",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  personTagText: {
    color: "#5c3b1e",
    fontWeight: "600",
  },
  chip: {
    borderWidth: 1,
    borderColor: Colors.light.rule,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.light.background,
  },
  chipSelected: {
    backgroundColor: Colors.light.text,
    borderColor: Colors.light.text,
  },
  chipText: {
    color: Colors.light.text,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: Colors.light.background,
  },
  stepButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.text,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: {
    color: Colors.light.background,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#efe5d4",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#5c3b1e",
    fontWeight: "700",
  },
  dangerButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    color: Colors.light.negative,
    fontWeight: "700",
  },
  errorBanner: {
    backgroundColor: "#fee2e2",
    borderRadius: 12,
    padding: 12,
  },
  errorBannerText: {
    color: "#991b1b",
    fontWeight: "600",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eadfcf",
    padding: 14,
    gap: 8,
    backgroundColor: Colors.light.background,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.light.text,
  },
  cardBody: {
    color: Colors.light.textSecondary,
  },
  explainer: {
    color: Colors.light.textSecondary,
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
    color: Colors.light.text,
  },
  positive: {
    color: Colors.light.positive,
  },
  negative: {
    color: Colors.light.negative,
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
    color: Colors.light.text,
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
