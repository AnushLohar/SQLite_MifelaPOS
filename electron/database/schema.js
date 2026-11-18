// electron/database/schema.js
exports.up = function (knex) {
    return knex.schema
        .createTable('local_users', table => {
            table.uuid('id').primary();
            table.string('username').notNullable().unique();
            table.string('password_hash').notNullable();
            table.string('role').defaultTo('user');
            table.boolean('is_active').defaultTo(true);
            table.string('firebase_uid').nullable(); // For future syncing
        })
        .createTable('licence_data', table => {
            table.string('id').primary();
            table.text('licence_payload').notNullable(); // Stored as JSON string
            table.text('signature').notNullable();
            table.timestamp('last_verified_at');
            table.timestamp('next_verification_due');
            table.string('status').defaultTo('UNACTIVATED');
        });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('licence_data').dropTableIfExists('local_users');
};