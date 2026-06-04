# Test Design Guidelines

## Tests Are Specifications

A specification answers: "In scenario X, what should happen?"

**Good spec format**:
- "When the user submits an empty form, display a validation error."
- "When the API returns 500, show a graceful error message."
- "When no records exist, display 'No results found'."

**Bad spec format**:
- "It works correctly." (What does 'correctly' mean?)
- "It handles errors." (Which errors? How?)
- "It validates input." (What validation? What happens on failure?)

Apply this to test names, `describe`/`context` blocks, and `it` descriptions. Every test should make the specified behavior obvious from the name alone.

## Describe the Essence

Name scenarios by the behavior they represent, not the implementation detail they exercise.

```ruby
# BAD: Names the implementation mechanism
describe "scope=failed" do
  # ...
end

# GOOD: Names the behavior
describe "rerunning only failed tests" do
  # ...
end
```

## Good Tests

**Integration-style**: Test through real interfaces, not mocks of internal parts.

```ruby
# GOOD: Tests observable behavior
describe "#checkout" do
  context "with a valid cart" do
    it "confirms the order" do
      cart = create(:cart, :with_items)
      result = checkout(cart, payment_method)
      expect(result.status).to eq("confirmed")
    end
  end
end
```

Characteristics:

- Tests behavior users/callers care about
- Uses public API only
- Survives internal refactors
- Describes WHAT, not HOW
- One logical assertion per test

## Bad Tests

**Implementation-detail tests**: Coupled to internal structure.

```ruby
# BAD: Tests implementation details
it "calls the payment service" do
  expect(payment_service).to receive(:process).with(cart.total)
  checkout(cart, payment_method)
end
```

Red flags:

- Mocking internal collaborators
- Testing private methods
- Asserting on call counts/order
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means instead of interface

```ruby
# BAD: Bypasses interface to verify
it "saves the user to the database" do
  create_user(name: "Alice")
  row = ActiveRecord::Base.connection.select_one("SELECT * FROM users WHERE name = 'Alice'")
  expect(row).to be_present
end

# GOOD: Verifies through interface
it "makes the user retrievable" do
  user = create_user(name: "Alice")
  retrieved = User.find(user.id)
  expect(retrieved.name).to eq("Alice")
end
```

## Assert Observable Outcomes, Not Method Calls

Assert on the end result, not whether a specific method was called. Mock-based assertions test means, not ends.

```ruby
# BAD: Tests that a method was called (implementation detail)
it "queues the task" do
  worker_pool = instance_double(WorkerPool, queue_task: nil)
  allow(WorkerPool).to receive(:new).and_return(worker_pool)

  QueueUnqueuedTasksJob.new.perform

  expect(worker_pool).to have_received(:queue_task).with(task)
end

# GOOD: Tests the observable outcome
it "queues the task" do
  expect { QueueUnqueuedTasksJob.new.perform }
    .to change { TaskEvent.where(name: "queued").count }.by(1)
end
```

Stub only what you must (external services), and let real code run so you can assert on real outcomes.

## Assert What's Essential, Not Incidental

Only assert what matters. Don't add assertions that are:
- Implied by other assertions
- Implementation details rather than behavior
- Noise that makes the test longer without adding meaning

```ruby
# BAD: Redundant assertion
it "no longer shows the deleted item" do
  delete item_path(item)
  expect(response).to be_successful  # redundant — if it wasn't, the next check tells you
  get items_path
  expect(response.body).not_to include(item.name)
end

# GOOD: Only the meaningful assertion
it "no longer shows the deleted item" do
  delete item_path(item)
  get items_path
  expect(response.body).not_to include(item.name)
end
```

## Arrange-Act-Assert

Structure tests with clear separation between setup, action, and verification. When setup is shared across tests, extract it. When the action is shared, extract it into a `before` block.

```ruby
# BAD: Setup, action, and assertion interleaved
it "completes the order" do
  order = create(:order)
  expect(order.status).to eq("pending")
  order.complete!
  expect(order.status).to eq("completed")  # mixing act + assert
end

# GOOD: Clear phases
describe "completing an order" do
  let!(:order) { create(:order) }

  before do
    order.complete!
  end

  it "sets status to completed" do
    expect(order.status).to eq("completed")
  end
end
```

## Appropriate Abstraction Level

Hide incidental details. Extract helpers for noisy setup or instrumentation so the test reads as a specification.

```ruby
# BAD: Incidental detail drowns the specification
it "does not query the database on subsequent calls" do
  dispatcher = TestSuiteRunDispatcher.new(cpu_headroom: 72000)

  query_count = 0
  callback = lambda { |*, _| query_count += 1 }
  ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
    dispatcher.undispatched_runs
    count_after_first = query_count
    dispatcher.undispatched_runs
    expect(query_count).to eq(count_after_first)
  end
end

# GOOD: Helper exposes intent
it "does not query the database on subsequent calls" do
  dispatcher = TestSuiteRunDispatcher.new(cpu_headroom: 72000)

  dispatcher.undispatched_runs
  second_call_count = count_queries { dispatcher.undispatched_runs }

  expect(second_call_count).to eq(0)
end
```

Put helpers _after_ tests — the helper itself is an incidental detail.

## No Speculative Test Code

Scrutinize timeouts, retries, waits, and workarounds in tests. If you can't justify it with a concrete reason, remove it.

```ruby
# Suspicious — is the wait actually needed?
expect(page).to have_content("Passed", wait: 3)
```

## Don't Use Hacks to Test Private Methods

Never use `#send` or `#public_send` to call private methods in tests. If you need to test a method directly, make it public. That's usually an acceptable tradeoff.

## Miscellaneous

- Never use `instance_variable_set` — it's a sign of poor design. Pause and suggest a refactor.
- Don't use `described_class` — it only adds obscurity. Use the actual class name.
