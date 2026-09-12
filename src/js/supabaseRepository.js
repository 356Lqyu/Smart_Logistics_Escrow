// Shared access point for application data stored in Supabase.
// Page scripts must use a repository instead of calling the Supabase client
// directly.

const TransactionRepository = Object.freeze({
  async record(records) {
    const rows = Array.isArray(records) ? records : [records];
    const { data, error } = await supabaseClient
      .from("transactions")
      .insert(rows);

    if (error) throw error;
    return data;
  },

  // `buildQuery` receives a transactions query only. This keeps the table
  // name and Supabase client details out of page-specific scripts while still
  // allowing each page to apply its own filters and selected fields.
  async find(buildQuery) {
    if (typeof buildQuery !== "function") {
      throw new TypeError("TransactionRepository.find requires a query builder.");
    }

    const { data, error, count } = await buildQuery(
      supabaseClient.from("transactions"),
    );
    if (error) throw error;
    return { data, count };
  },

  async query(buildQuery) {
    if (typeof buildQuery !== "function") {
      throw new TypeError("TransactionRepository.query requires a query builder.");
    }
    return buildQuery(supabaseClient.from("transactions"));
  },
});
